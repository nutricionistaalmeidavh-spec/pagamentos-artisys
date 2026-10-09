import http from 'node:http';
import { readFileSync, existsSync, lstatSync, createReadStream, mkdirSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { asaasRequest, createCheckout, checkoutAmountCents } from './asaas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const stamp = () => new Date().toISOString();
const uid = () => randomUUID();
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const obj = data => data && typeof data === 'object' && !Array.isArray(data) ? data : {};
const isEmail = s => typeof s === 'string' && s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const safeId = s => typeof s === 'string' && /^[a-z0-9][a-z0-9_.-]{2,79}$/.test(s);
const error = (code, status=400) => Object.assign(new Error(code), { status });
const equal = (a,b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x,y);
};
const auth = req => String(req.headers.authorization || '').replace(/^Bearer /i, '').trim();
const json = (res,status,body,extra={}) => {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store',
    'x-content-type-options':'nosniff', ...extra });
  res.end(JSON.stringify(body));
};
const publicOrder = row => row && ({
  id:row.id, offerId:row.offer_id, productId:row.product_id,
  amountCents:row.amount_cents, currency:row.currency,
  saleType:row.sale_type, status:row.status, paymentProvider:row.payment_provider,
  checkoutUrl:row.checkout_url, checkoutState:row.checkout_state,
  fulfillmentStatus:row.fulfillment_status, createdAt:row.created_at
});
const validArtifact = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(name) && name !== '.' && name !== '..';

export function createApp(options={}) {
  const env={...process.env,...options.env};
  const dbPath=options.dbPath || env.DB_PATH || resolve(ROOT,'data/payments.sqlite');
  if(dbPath !== ':memory:') mkdirSync(dirname(dbPath),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec(readFileSync(resolve(ROOT,'schema.sql'),'utf8'));
  db.exec('PRAGMA busy_timeout = 5000');
  const get=(q,...v)=>db.prepare(q).get(...v);
  const all=(q,...v)=>db.prepare(q).all(...v);
  const run=(q,...v)=>db.prepare(q).run(...v);
  const txn=fn=>{ db.exec('BEGIN IMMEDIATE'); try{const result=fn(); db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;} };
  const fetchImpl=options.fetchImpl||fetch;
  const releases=resolve(env.RELEASES_DIR||join(dirname(dbPath),'releases'));
  const origins=String(env.PUBLIC_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const connectionMap=()=>{ try{return obj(JSON.parse(env.PRODUCT_CONNECTORS_JSON||'{}'));}catch{return{};} };
  const audit=(kind,subject,details)=>run('INSERT INTO audit_logs VALUES(?,?,?,?,?)',uid(),kind,subject,JSON.stringify(details),stamp());
  const requireAdmin=req=>{
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw error('admin_not_configured',503);
    if (!equal(auth(req),env.ADMIN_TOKEN)) throw error('unauthorized',401);
  };
  const requireOrder=(req,id)=>{
    const row=get('SELECT * FROM orders WHERE id=?',id);
    if(!row || !equal(hash(auth(req)),row.access_hash)) throw error('order_not_found',404);
    return row;
  };
  const queueFulfillment=(order,action='activate')=>{
    if(action==='activate' && order.status!=='paid') return;
    run("INSERT OR IGNORE INTO fulfillments(id,order_id,action,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)",uid(),order.id,action,stamp(),stamp());
    if(action==='activate') run("UPDATE orders SET fulfillment_status='pending',updated_at=? WHERE id=? AND fulfillment_status='not_started'",stamp(),order.id);
  };
  const paid=(row,source)=>{
    if(row.status==='paid' || row.status==='fulfilled') return;
    if(row.status==='refunded' || row.status==='canceled') throw error('invalid_payment_transition',409);
    txn(()=>{
      run("UPDATE orders SET status='paid',checkout_state='paid',updated_at=? WHERE id=?",stamp(),row.id);
      queueFulfillment({...row,status:'paid'});
      audit('payment_confirmed',row.id,{source});
    });
  };
  const validateEvent=(event,row)=>{
    const checkout=obj(event.checkout);
    if(checkout.id!==row.checkout_id) throw new Error('checkout_id_mismatch');
    if(checkout.externalReference && checkout.externalReference!==row.id) throw new Error('external_reference_mismatch');
    const cents=checkoutAmountCents(checkout);
    if(cents===null || cents!==row.amount_cents) throw new Error('checkout_amount_mismatch');
  };
  let queueBusy=false;
  const processPending=async()=>{
    if(queueBusy)return;
    queueBusy=true;
    try{
      for(const stored of all("SELECT * FROM provider_events WHERE status IN ('received','failed') AND next_attempt_at<=? ORDER BY received_at LIMIT 30",Date.now())){
        try {
          const event=JSON.parse(stored.payload),type=stored.event_type,checkout=obj(event.checkout);
          let order=null;
          if(checkout.id)order=get('SELECT * FROM orders WHERE checkout_id=?',String(checkout.id));
          if(type==='CHECKOUT_PAID'){
            if(!order)throw new Error('checkout_order_not_linked');
            validateEvent(event,order);
            if(order.status==='pending')paid(order,'asaas:' + stored.id);
            else if(order.status!=='paid')throw new Error('invalid_payment_transition');
          } else if(type==='CHECKOUT_CANCELED' || type==='CHECKOUT_EXPIRED'){
            if(!order)throw new Error('checkout_order_not_linked');
            if(order.status==='pending')run("UPDATE orders SET status=?,checkout_state=?,updated_at=? WHERE id=?",type==='CHECKOUT_EXPIRED'?'expired':'canceled',type==='CHECKOUT_EXPIRED'?'expired':'canceled',stamp(),order.id);
          } else if(type==='CHECKOUT_CREATED'){
            if(!order)throw new Error('checkout_order_not_linked');
          } else if(type==='PAYMENT_REFUNDED'){
            const ref=String(obj(event.payment).externalReference||'');
            const row=ref?get("SELECT * FROM orders WHERE id=? AND payment_provider='asaas'",ref):null;
            if(!row)throw new Error('refund_order_not_linked');
            if(row.status==='paid'){
              txn(()=>{run("UPDATE orders SET status='refunded',updated_at=? WHERE id=?",stamp(),row.id);queueFulfillment(row,'revoke');audit('refunded',row.id,{eventId:stored.id});});
            }
          } else if(type==='SUBSCRIPTION_CREATED'){
            const sub=obj(event.subscription),ref=String(sub.externalReference||'');
            const row=ref?get("SELECT * FROM orders WHERE id=? AND payment_provider='asaas'",ref):null;
            if(!row)throw new Error('subscription_order_not_linked');
            if(sub.id)run('UPDATE orders SET subscription_id=?,updated_at=? WHERE id=?',String(sub.id),stamp(),row.id);
          } else if(type==='PAYMENT_RECEIVED'||type==='PAYMENT_CONFIRMED'){
            const payment=obj(event.payment),subId=String(payment.subscription||'');
            const subOrder=subId?get("SELECT * FROM orders WHERE subscription_id=? AND payment_provider='asaas'",subId):null;
            if(subOrder && subOrder.status==='paid' && Math.round(Number(payment.value||0)*100)===subOrder.amount_cents)
              queueFulfillment(subOrder,'renew:' + String(payment.id||stored.id));
          }
          run("UPDATE provider_events SET status='processed',last_error=NULL,processed_at=? WHERE id=?",stamp(),stored.id);
        } catch(e){
          const tries=stored.attempts+1;
          run("UPDATE provider_events SET status='failed',attempts=?,last_error=?,next_attempt_at=? WHERE id=?",tries,String(e.message).slice(0,300),Date.now()+Math.min(3600000,30000*2**Math.min(tries,6)),stored.id);
        }
      }
      for(const job of all("SELECT f.*,o.product_id,o.customer_email,o.customer_name,o.amount_cents,o.currency,o.sale_type,o.status AS order_status,o.delivery_mode,o.artifact_name FROM fulfillments f JOIN orders o ON o.id=f.order_id WHERE f.status IN ('pending','failed') AND f.next_attempt_at<=? ORDER BY f.created_at LIMIT 20",Date.now())){
        try{
          if(job.action!=='revoke' && job.order_status!=='paid')throw new Error('order_not_paid');
          const connector=obj(connectionMap()[job.product_id]);
          if(job.action==='activate' && job.delivery_mode==='manual'){
            run("UPDATE fulfillments SET status='awaiting_manual',updated_at=? WHERE id=?",stamp(),job.id);
            run("UPDATE orders SET fulfillment_status='awaiting_manual' WHERE id=?",job.order_id);
            continue;
          }
          if(job.action==='activate' && job.delivery_mode==='download'){
            const path=resolve(releases,job.artifact_name||'');
            if(!validArtifact(job.artifact_name)||dirname(path)!==releases||!existsSync(path)||!lstatSync(path).isFile()) {
              run("UPDATE fulfillments SET status='waiting_configuration',last_error='artifact_unavailable',updated_at=? WHERE id=?",stamp(),job.id);
              run("UPDATE orders SET fulfillment_status='waiting_configuration' WHERE id=?",job.order_id);
              continue;
            }
          } else {
            if(!connector.url||!connector.secret){
              run("UPDATE fulfillments SET status='waiting_configuration',last_error='connector_not_configured',updated_at=? WHERE id=?",stamp(),job.id);
              if(job.action==='activate')run("UPDATE orders SET fulfillment_status='waiting_configuration' WHERE id=?",job.order_id);
              continue;
            }
            const target=new URL(connector.url),allowed=String(env.CONNECTOR_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
            if(target.protocol!=='https:'||!allowed.includes(target.origin)||target.username||target.password)throw new Error('connector_origin_not_allowed');
            const payload=JSON.stringify({event:'artisys.'+(job.action==='revoke'?'license.revoke':job.action.startsWith('renew:')?'license.renew':'license.activate'),orderId:job.order_id,productId:job.product_id,email:job.customer_email,customerName:job.customer_name,amountCents:job.amount_cents,currency:job.currency,saleType:job.sale_type,idempotencyKey:job.id});
            const signedAt=String(Date.now()),signature=createHmac('sha256',connector.secret).update(signedAt+'.'+payload).digest('hex');
            const response=await fetchImpl(connector.url,{method:'POST',headers:{'content-type':'application/json','x-artisys-timestamp':signedAt,'x-artisys-signature':'sha256='+signature,'x-artisys-delivery-id':job.id},body:payload,signal:AbortSignal.timeout(10000),redirect:'error'});
            if(!response.ok)throw new Error('connector_http_'+response.status);
            const confirmation=await response.json().catch(()=>({}));
            if(confirmation.accepted!==true)throw new Error('connector_ack_missing');
          }
          run("UPDATE fulfillments SET status='delivered',last_error=NULL,updated_at=? WHERE id=?",stamp(),job.id);
          if(job.action==='activate')run("UPDATE orders SET fulfillment_status='delivered',updated_at=? WHERE id=?",stamp(),job.order_id);
          audit('delivered',job.order_id,{action:job.action});
        }catch(e){
          const tries=job.attempts+1;
          run("UPDATE fulfillments SET status='failed',attempts=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?",tries,String(e.message).slice(0,300),Date.now()+Math.min(3600000,30000*2**Math.min(tries,6)),stamp(),job.id);
        }
      }
    } finally {queueBusy=false;}
  };
  async function body(req) {
    let size=0,text='';
    for await (const chunk of req) {size+=chunk.length;if(size>131072)throw error('payload_too_large',413);text+=chunk.toString('utf8');}
    try{return text?JSON.parse(text):{};}catch{throw error('invalid_json',400);}
  }
  const publicCors=(req,res)=>{
    const origin=String(req.headers.origin||'');
    if(origin && origins.includes(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','content-type,authorization,idempotency-key');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
    }
    return !origin || origins.includes(origin);
  };
  const serve=(res,path,type)=>{
    const data=readFileSync(resolve(ROOT,'public',path));
    res.writeHead(200,{'content-type':type,'cache-control':'no-cache','x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' " + origins.join(' ') + "; img-src 'self' data:; frame-ancestors 'none'"});
    res.end(data);
  };
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/', 'http://localhost'), path=url.pathname,method=req.method||'GET';
    try{
      const corsOK=publicCors(req,res);
      if(method==='OPTIONS'){if(!corsOK)throw error('origin_not_allowed',403);return json(res,204,{});}
      if(method==='GET' && path==='/healthz')return json(res,200,{ok:true,service:'Pagamento ArtiSys'});
      if(method==='GET' && path==='/')return serve(res,'checkout.html','text/html; charset=utf-8');
      if(method==='GET' && (path==='/comprar'||path==='/pedido'))return serve(res,'checkout.html','text/html; charset=utf-8');
      if(method==='GET' && path==='/admin')return serve(res,'admin.html','text/html; charset=utf-8');
      if(method==='GET' && path==='/assets/style.css')return serve(res,'style.css','text/css; charset=utf-8');
      if(method==='GET' && path==='/assets/admin.js')return serve(res,'admin.js','application/javascript; charset=utf-8');
      if(method==='GET' && path==='/assets/checkout.js')return serve(res,'checkout.js','application/javascript; charset=utf-8');
      if(method==='GET' && path==='/v1/catalog'){
        return json(res,200,{offers:all("SELECT id,product_id,name,description,price_cents,currency,sale_type,delivery_mode FROM offers WHERE active=1 ORDER BY name").map(x=>({id:x.id,productId:x.product_id,name:x.name,description:x.description,priceCents:x.price_cents,currency:x.currency,saleType:x.sale_type,deliveryMode:x.delivery_mode}))});
      }
      if(method==='POST' && path==='/v1/orders'){
        if(!corsOK)throw error('origin_not_allowed',403);
        const input=obj(await body(req)),email=String(input.email||'').trim().toLowerCase(),
              name=String(input.name||'').trim().slice(0,120),
              idem=String(req.headers['idempotency-key']||input.idempotencyKey||'');
        if(!isEmail(email)||!safeId(input.offerId)||idem.length<16||idem.length>120)throw error('invalid_order',400);
        const offer=get('SELECT * FROM offers WHERE id=? AND active=1',input.offerId);
        if(!offer)throw error('offer_not_available',404);
        const old=get('SELECT * FROM orders WHERE customer_email=? AND idem_key=?',email,idem);
        if(old)throw error('idempotency_key_already_used',409);
        const coupon=String(input.couponCode||'').trim().toUpperCase();
        const promo=coupon?get('SELECT * FROM coupons WHERE code=? AND active=1',coupon):null;
        if(coupon&&!promo)throw error('invalid_coupon',400);
        const price=Math.max(1,Math.round(offer.price_cents*(100-(promo?.percent_off||0))/100));
        const access=token(),now=stamp(),id=uid();
        try {
          run("INSERT INTO orders(id,offer_id,product_id,customer_email,customer_name,amount_cents,original_amount_cents,coupon_code,currency,sale_type,delivery_mode,artifact_name,access_hash,idem_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,offer.id,offer.product_id,email,name,price,offer.price_cents,coupon||null,offer.currency,offer.sale_type,offer.delivery_mode,offer.artifact_name,hash(access),idem,now,now);
        }catch(e){if(String(e.message).includes('UNIQUE'))throw error('idempotency_key_already_used',409);throw e;}
        return json(res,201,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',id)),orderAccessToken:access});
      }
      const matchOrder=path.match(/^\/v1\/orders\/([a-f0-9-]{36})(?:\/(checkout|download))?$/);
      if(matchOrder){
        const row=requireOrder(req,matchOrder[1]);
        if(method==='GET'&&!matchOrder[2])return json(res,200,{order:publicOrder(row)});
        if(method==='GET'&&matchOrder[2]==='download'){
          if(row.status!=='paid'||row.fulfillment_status!=='delivered'||row.delivery_mode!=='download')throw error('download_not_ready',409);
          if(!validArtifact(row.artifact_name))throw error('download_unavailable',404);
          const file=resolve(releases,row.artifact_name);
          if(dirname(file)!==releases||!existsSync(file)||!lstatSync(file).isFile())throw error('download_unavailable',404);
          res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+basename(file)+'"','cache-control':'no-store','x-content-type-options':'nosniff'});
          return createReadStream(file).pipe(res);
        }
        if(method==='POST'&&matchOrder[2]==='checkout'){
          if(!corsOK)throw error('origin_not_allowed',403);
          const input=obj(await body(req)),provider=String(input.provider||'');
          if(!['asaas','manual_pix'].includes(provider))throw error('invalid_provider',400);
          if(row.status!=='pending'||['canceled','expired'].includes(row.checkout_state))throw error('order_not_payable',409);
          if(row.payment_provider && row.payment_provider!==provider)throw error('provider_already_selected',409);
          if(row.checkout_state==='verifying')throw error('checkout_requires_reconciliation',409);
          if(row.checkout_url)return json(res,200,{order:publicOrder(row),checkoutUrl:row.checkout_url});
          if(provider==='manual_pix'){
            if(row.sale_type!=='one_time'||!env.MANUAL_PIX_KEY)throw error('manual_pix_unavailable',503);
            run("UPDATE orders SET payment_provider='manual_pix',checkout_state='awaiting_manual_payment',updated_at=? WHERE id=?",stamp(),row.id);
            return json(res,200,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',row.id)),manualPixKey:env.MANUAL_PIX_KEY,notice:'Pagamento pendente de confirmação administrativa.'});
          }
          if(!env.ASAAS_API_KEY || !env.PUBLIC_BASE_URL || !env.ASAAS_WEBHOOK_TOKEN)throw error('asaas_not_configured',503);
          const base=new URL(env.PUBLIC_BASE_URL);
          if(base.protocol!=='https:' && base.hostname!=='localhost')throw error('public_url_not_https',503);
          const offer=get('SELECT * FROM offers WHERE id=?',row.offer_id);
          run("UPDATE orders SET payment_provider='asaas',checkout_state='verifying',updated_at=? WHERE id=?",stamp(),row.id);
          try {
            const checkout=await createCheckout(env,fetchImpl,row,offer);
            run("UPDATE orders SET checkout_id=?,checkout_url=?,checkout_state='ready',updated_at=? WHERE id=?",checkout.id,checkout.link,stamp(),row.id);
            return json(res,200,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',row.id)),checkoutUrl:checkout.link});
          }catch(e) {
            audit('checkout_uncertain',row.id,{error:String(e.message).slice(0,100)});
            throw error('checkout_requires_reconciliation',502);
          }
        }
      }
      if(method==='GET'&&path==='/v1/customer/purchases'){
        const found=get('SELECT * FROM orders WHERE access_hash=?',hash(auth(req)));
        if(!found)throw error('unauthorized',401);
        const purchases=all('SELECT * FROM orders WHERE customer_email=? ORDER BY created_at DESC LIMIT 100',found.customer_email);
        return json(res,200,{purchases:purchases.map(publicOrder)});
      }
      if(method==='POST'&&path==='/v1/webhooks/asaas'){
        if(!env.ASAAS_WEBHOOK_TOKEN||env.ASAAS_WEBHOOK_TOKEN.length<32)throw error('webhook_not_configured',503);
        if(!equal(String(req.headers['asaas-access-token']||''),env.ASAAS_WEBHOOK_TOKEN))throw error('unauthorized',401);
        const payload=obj(await body(req));
        if(typeof payload.id!=='string'||payload.id.length>200||!payload.id||typeof payload.event!=='string'||!payload.event)throw error('invalid_event',400);
        run("INSERT OR IGNORE INTO provider_events(id,event_type,payload,received_at) VALUES(?,?,?,?)",payload.id,payload.event,JSON.stringify(payload),stamp());
        return json(res,200,{received:true});
      }
      if(path.startsWith('/v1/admin/')){
        requireAdmin(req);
        if(method==='GET'&&path==='/v1/admin/summary'){
          const summary=get("SELECT count(*) AS orders, coalesce(sum(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS receivedCents, sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN status='refunded' THEN 1 ELSE 0 END) AS refunded FROM orders");
          return json(res,200,{summary:{...summary,failedEvents:get("SELECT count(*) AS count FROM provider_events WHERE status='failed'").count},integrations:Object.entries(connectionMap()).map(([productId,c])=>({productId,configured:!!(c?.url&&c?.secret)}))});
        }
        if(method==='GET'&&path==='/v1/admin/offers')return json(res,200,{offers:all('SELECT * FROM offers ORDER BY updated_at DESC')});
        if(method==='POST'&&path==='/v1/admin/offers'){
          const p=obj(await body(req)),id=String(p.id||''),product=String(p.productId||''),price=Number(p.priceCents),
                sale=String(p.saleType||'one_time'),delivery=String(p.deliveryMode||'manual'),
                artifact=p.artifactName||null;
          if(!safeId(id)||!safeId(product)||!String(p.name||'').trim()||!Number.isInteger(price)||price<1||price>100000000||!['one_time','monthly','yearly'].includes(sale)||!['manual','download','webhook'].includes(delivery)||(artifact&&!validArtifact(artifact)))throw error('invalid_offer',400);
          const now=stamp();
          run("INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES(?,?,?,?,?,'BRL',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,sale_type=excluded.sale_type,delivery_mode=excluded.delivery_mode,artifact_name=excluded.artifact_name,active=excluded.active,updated_at=excluded.updated_at",id,product,String(p.name).trim().slice(0,140),String(p.description||'').slice(0,500),price,sale,delivery,artifact,p.active?1:0,now,now);
          audit('offer_updated',id,{price,sale,delivery});
          return json(res,200,{offer:get('SELECT * FROM offers WHERE id=?',id)});
        }
        if(method==='GET'&&path==='/v1/admin/coupons')return json(res,200,{coupons:all('SELECT * FROM coupons ORDER BY created_at DESC')});
        if(method==='POST'&&path==='/v1/admin/coupons'){
          const p=obj(await body(req)),code=String(p.code||'').trim().toUpperCase(),percent=Number(p.percentOff);
          if(!/^[A-Z0-9_-]{3,30}$/.test(code)||!Number.isInteger(percent)||percent<1||percent>90)throw error('invalid_coupon',400);
          run('INSERT INTO coupons(code,percent_off,active,created_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET percent_off=excluded.percent_off,active=excluded.active',code,percent,p.active===false?0:1,stamp());
          return json(res,200,{coupon:get('SELECT * FROM coupons WHERE code=?',code)});
        }
        if(method==='GET'&&path==='/v1/admin/orders')return json(res,200,{orders:all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').map(x=>({...publicOrder(x),customerEmail:x.customer_email,customerName:x.customer_name}))});
        if(method==='GET'&&path==='/v1/admin/events')return json(res,200,{events:all('SELECT id,event_type,status,attempts,last_error,received_at,processed_at FROM provider_events ORDER BY received_at DESC LIMIT 200')});
        if(method==='GET'&&path==='/v1/admin/fulfillments')return json(res,200,{fulfillments:all('SELECT id,order_id,action,status,attempts,last_error,updated_at FROM fulfillments ORDER BY created_at DESC LIMIT 200')});
        const mark=path.match(/^\/v1\/admin\/orders\/([a-f0-9-]{36})\/(confirm-manual|deliver-manual|reconcile)$/);
        if(mark&&method==='POST'){
          const row=get('SELECT * FROM orders WHERE id=?',mark[1]);if(!row)throw error('order_not_found',404);
          if(mark[2]==='confirm-manual'){
            if(row.payment_provider!=='manual_pix'||row.status!=='pending')throw error('manual_payment_not_pending',409);
            paid(row,'manual_admin');
            return json(res,200,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',row.id))});
          }
          if(mark[2]==='deliver-manual'){
            if(row.delivery_mode!=='manual'||row.status!=='paid')throw error('manual_fulfillment_not_allowed',409);
            run("UPDATE fulfillments SET status='delivered',updated_at=? WHERE order_id=? AND action='activate'",stamp(),row.id);
            run("UPDATE orders SET fulfillment_status='delivered',updated_at=? WHERE id=?",stamp(),row.id);
            audit('manual_delivery',row.id,{});
            return json(res,200,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',row.id))});
          }
          if(mark[2]==='reconcile'){
            if(row.payment_provider!=='asaas'||!row.checkout_id)throw error('no_checkout_to_reconcile',409);
            const actual=await asaasRequest(env,fetchImpl,'/checkouts/'+encodeURIComponent(row.checkout_id));
            validateEvent({checkout:actual},row);
            if(String(actual.status).toUpperCase()==='PAID')paid(row,'asaas_reconciliation');
            return json(res,200,{order:publicOrder(get('SELECT * FROM orders WHERE id=?',row.id)),providerStatus:actual.status});
          }
        }
        const replay=path.match(/^\/v1\/admin\/(events|fulfillments)\/([^/]+)\/replay$/);
        if(method==='POST'&&replay){
          if(replay[1]==='events')run("UPDATE provider_events SET status='received',next_attempt_at=0,last_error=NULL WHERE id=?",decodeURIComponent(replay[2]));
          else run("UPDATE fulfillments SET status='pending',next_attempt_at=0,last_error=NULL WHERE id=?",decodeURIComponent(replay[2]));
          await processPending();
          return json(res,202,{accepted:true});
        }
        throw error('route_not_found',404);
      }
      throw error('route_not_found',404);
    }catch(e){
      if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'internal_error'});
    }
  });
  const timer=options.autoprocess===false?null:setInterval(()=>processPending().catch(()=>{}),2000);
  if(timer)timer.unref();
  const close=()=>{if(timer)clearInterval(timer);db.close();};
  return {server,db,processPending,close};
}
