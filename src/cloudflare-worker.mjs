import {createCheckout,verifyCheckoutPayment,verifyPaymentEvent} from './asaas.mjs';
import {diagnoseAsaas} from './asaas-diagnostic.mjs';
import {CATALOG_DRAFTS} from './catalog-drafts.mjs';
import {systemReleaseAdmin} from './system-release-admin.mjs';
import {verifyReleaseGithubOidc} from './github-oidc.mjs';

const schema=[
  "CREATE TABLE IF NOT EXISTS offers(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price_cents INTEGER NOT NULL CHECK(price_cents>0),currency TEXT NOT NULL DEFAULT 'BRL',sale_type TEXT NOT NULL DEFAULT 'one_time',delivery_mode TEXT NOT NULL DEFAULT 'manual',artifact_name TEXT,active INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY,percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 90),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,offer_id TEXT NOT NULL,product_id TEXT NOT NULL,customer_email TEXT NOT NULL,customer_name TEXT NOT NULL DEFAULT '',amount_cents INTEGER NOT NULL,original_amount_cents INTEGER NOT NULL,coupon_code TEXT,currency TEXT NOT NULL DEFAULT 'BRL',sale_type TEXT NOT NULL,delivery_mode TEXT NOT NULL,artifact_name TEXT,status TEXT NOT NULL DEFAULT 'pending',payment_provider TEXT,checkout_id TEXT UNIQUE,provider_payment_id TEXT UNIQUE,checkout_url TEXT,checkout_state TEXT NOT NULL DEFAULT 'not_started',fulfillment_status TEXT NOT NULL DEFAULT 'not_started',subscription_id TEXT,access_hash TEXT NOT NULL,idem_key TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(customer_email,idem_key))",
  "CREATE TABLE IF NOT EXISTS provider_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt_at INTEGER NOT NULL DEFAULT 0,locked_at INTEGER NOT NULL DEFAULT 0,received_at TEXT NOT NULL,processed_at TEXT)",
  "CREATE TABLE IF NOT EXISTS fulfillments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,action TEXT NOT NULL DEFAULT 'activate',status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,locked_at INTEGER NOT NULL DEFAULT 0,response_json TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(order_id,action))",
  "CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_events_pending ON provider_events(status,next_attempt_at)",
  "CREATE INDEX IF NOT EXISTS idx_jobs_pending ON fulfillments(status,next_attempt_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status,created_at)"
];
const now=()=>new Date().toISOString(),uuid=()=>crypto.randomUUID();
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const validId=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9_.-]{2,79}$/.test(x);
const validArtifact=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(x)&&x!=='.'&&x!=='..';
const validEmail=x=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const headerToken=request=>String(request.headers.get('authorization')||'').replace(/^Bearer /i,'').trim();
const bytes=x=>new TextEncoder().encode(String(x));
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const safeEqual=async (a,b)=>{
 if(!a||!b)return false;
 const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;
 for(let i=0;i<64;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);
 return diff===0;
};
const selection={id:'id',offerId:'offer_id',productId:'product_id',amountCents:'amount_cents',currency:'currency',saleType:'sale_type',status:'status',paymentProvider:'payment_provider',checkoutUrl:'checkout_url',checkoutState:'checkout_state',fulfillmentStatus:'fulfillment_status',createdAt:'created_at'};
const publicOrder=row=>row&&Object.fromEntries(Object.entries(selection).map(([k,v])=>[k,row[v]??null]));
const query=(db,sql,...args)=>db.prepare(sql).bind(...args);
let readyDb=null,readyPromise=null;
async function initialize(env){
 if(!env.PAGAMENTO_ARTISYS_DB)throw fail('d1_not_configured',503);
 if(readyDb!==env.PAGAMENTO_ARTISYS_DB){readyDb=env.PAGAMENTO_ARTISYS_DB;readyPromise=null;}
 if(!readyPromise)readyPromise=env.PAGAMENTO_ARTISYS_DB.batch(schema.map(sql=>env.PAGAMENTO_ARTISYS_DB.prepare(sql))).catch(e=>{readyPromise=null;throw e;});
 await readyPromise;
}
const read=async (request)=>{const raw=await request.text();if(raw.length>131072)throw fail('payload_too_large',413);try{return raw?JSON.parse(raw):{};}catch{throw fail('invalid_json');}};
const one=async(db,sql,...args)=>query(db,sql,...args).first();
const rows=async(db,sql,...args)=>(await query(db,sql,...args).all()).results||[];
const exec=async(db,sql,...args)=>query(db,sql,...args).run();
async function audit(db,kind,subject,details){await exec(db,"INSERT INTO audit_logs(id,kind,subject_id,details,created_at) VALUES(?,?,?,?,?)",uuid(),kind,subject,JSON.stringify(details),now());}

const CATALOG_SOURCE='devkittools-sistemas-2026-10-09';
async function insertMissingCatalogDrafts(db){
 // Falha fechada: esta operação nunca publica ou atualiza um registro existente.
 if(CATALOG_DRAFTS.length!==67||CATALOG_DRAFTS.some(x=>x.active!==false))throw Error('catalog_draft_invalid');
 const stamp=now();
 const statements=CATALOG_DRAFTS.map(v=>db.prepare("INSERT OR IGNORE INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES(?,?,?,?,?,'BRL',?,?,?,?,?,?)").bind(v.id,v.productId,v.name,v.description,v.priceCents,v.saleType,v.deliveryMode,v.artifactName||null,0,stamp,stamp));
 const result=await db.batch(statements);
 const created=result.reduce((sum,item)=>sum+Number(item?.meta?.changes||0),0);
 return {expected:CATALOG_DRAFTS.length,created,alreadyExisting:CATALOG_DRAFTS.length-created,active:false};
}
async function initialCatalogImport(env){
 const db=env.PAGAMENTO_ARTISYS_DB;
 const done=await one(db,"SELECT id FROM audit_logs WHERE kind='catalog_seed_completed' AND subject_id=? LIMIT 1",CATALOG_SOURCE);
 if(done)return;
 const result=await insertMissingCatalogDrafts(db);
 await audit(db,'catalog_seed_completed',CATALOG_SOURCE,result);
}

async function admin(request,env){
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32)throw fail('admin_not_configured',503);
 if(!await safeEqual(headerToken(request),env.ADMIN_TOKEN))throw fail('unauthorized',401);
}
async function authorizedOrder(request,env,id){
 const found=await one(env.PAGAMENTO_ARTISYS_DB,'SELECT * FROM orders WHERE id=?',id);
 if(!found||!await safeEqual(await digest(headerToken(request)),found.access_hash))throw fail('order_not_found',404);
 return found;
}
async function markPaid(env,order,origin,proof=null){
 if(order.status==='paid')return;
 if(order.status!=='pending')throw fail('invalid_transition',409);
 if(proof&&order.payment_provider!=='asaas')throw fail('provider_mismatch',409);
 const d=env.PAGAMENTO_ARTISYS_DB,t=now(),paymentId=proof?.paymentId||null;
 const taken=paymentId?await one(d,'SELECT id FROM orders WHERE provider_payment_id=?',paymentId):null;
 if(taken&&taken.id!==order.id)throw fail('payment_already_consumed',409);
 const updated=await exec(d,"UPDATE orders SET status='paid',checkout_state='paid',provider_payment_id=COALESCE(?,provider_payment_id),subscription_id=COALESCE(?,subscription_id),fulfillment_status='pending',updated_at=? WHERE id=? AND status='pending'",paymentId,proof?.subscriptionId||null,t,order.id);
 if(!updated.meta?.changes)return;
 await exec(d,"INSERT OR IGNORE INTO fulfillments(id,order_id,action,status,created_at,updated_at) VALUES(?,?, 'activate','pending',?,?)",uuid(),order.id,t,t);
 await audit(d,'payment_confirmed',order.id,{origin,paymentId});
}
async function enqueue(env,order,action){
 await exec(env.PAGAMENTO_ARTISYS_DB,"INSERT OR IGNORE INTO fulfillments(id,order_id,action,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)",uuid(),order.id,action,now(),now());
}
function connectorFor(env,product){
 let conf={};try{conf=isObj(JSON.parse(env.PRODUCT_CONNECTORS_JSON||'{}'));}catch{}
 return isObj(conf[product]);
}
async function hmac(secret,input){
 const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes(input)))).map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function deliver(env,job){
 const order=await one(env.PAGAMENTO_ARTISYS_DB,'SELECT * FROM orders WHERE id=?',job.order_id);
 if(!order)throw Error('order_missing');
 if(job.action!=='revoke'&&order.status!=='paid')throw Error('order_not_paid');
 if(job.action==='activate'&&order.delivery_mode==='manual'){
  await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE fulfillments SET status='awaiting_manual',updated_at=? WHERE id=?",now(),job.id);
  await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE orders SET fulfillment_status='awaiting_manual' WHERE id=?",order.id);return;
 }
 if(job.action==='activate'&&order.delivery_mode==='download'){
  if(!validArtifact(order.artifact_name)||!env.PAGAMENTO_ARTISYS_ARQUIVOS){
   await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE fulfillments SET status='waiting_configuration',last_error='r2_or_artifact_not_configured',updated_at=? WHERE id=?",now(),job.id);
   await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE orders SET fulfillment_status='waiting_configuration' WHERE id=?",order.id);return;
  }
  const obj=await env.PAGAMENTO_ARTISYS_ARQUIVOS.head('releases/'+order.artifact_name);
  if(!obj){
   await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE fulfillments SET status='waiting_configuration',last_error='artifact_not_found',updated_at=? WHERE id=?",now(),job.id);
   await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE orders SET fulfillment_status='waiting_configuration' WHERE id=?",order.id);return;
  }
 }else{
  const target=connectorFor(env,order.product_id),origin=String(env.CONNECTOR_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
  if(!target.url||!target.secret){
   await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE fulfillments SET status='waiting_configuration',last_error='connector_missing',updated_at=? WHERE id=?",now(),job.id);
   if(job.action==='activate')await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE orders SET fulfillment_status='waiting_configuration' WHERE id=?",order.id);
   return;
  }
  const uri=new URL(target.url);
  if(uri.protocol!=='https:'||!origin.includes(uri.origin)||uri.username||uri.password)throw Error('connector_origin_rejected');
  const action=job.action==='revoke'?'license.revoke':job.action.startsWith('renew:')?'license.renew':'license.activate';
  const payload=JSON.stringify({event:'artisys.'+action,orderId:order.id,productId:order.product_id,email:order.customer_email,customerName:order.customer_name,amountCents:order.amount_cents,currency:order.currency,saleType:order.sale_type,idempotencyKey:job.id});
  const ts=String(Date.now()),signature=await hmac(target.secret,ts+'.'+payload);
  const response=await fetch(uri.toString(),{method:'POST',headers:{'content-type':'application/json','x-artisys-timestamp':ts,'x-artisys-signature':'sha256='+signature,'x-artisys-delivery-id':job.id},body:payload,signal:AbortSignal.timeout(10000),redirect:'error'});
  const confirmation=await response.json().catch(()=>null);
  if(!response.ok||confirmation?.accepted!==true)throw Error('connector_delivery_unconfirmed');
 }
 await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE fulfillments SET status='delivered',last_error=NULL,updated_at=? WHERE id=?",now(),job.id);
 if(job.action==='activate')await exec(env.PAGAMENTO_ARTISYS_DB,"UPDATE orders SET fulfillment_status='delivered' WHERE id=?",order.id);
 await audit(env.PAGAMENTO_ARTISYS_DB,'delivery_confirmed',order.id,{action:job.action});
}
async function eventHandler(env,event){
 const d=env.PAGAMENTO_ARTISYS_DB,type=event.event_type,payload=JSON.parse(event.payload);
 const checkout=isObj(payload.checkout);
 const order=checkout.id?await one(d,'SELECT * FROM orders WHERE checkout_id=?',String(checkout.id)):null;
 if(type==='CHECKOUT_PAID'){
  if(!order)throw Error('checkout_not_found');
  if(checkout.externalReference&&checkout.externalReference!==order.id)throw Error('reference_mismatch');
  const amounts=Array.isArray(checkout.items)?checkout.items.map(x=>Math.round(Number(x.value)*100)*Number(x.quantity)):null;
  if(amounts&&amounts.reduce((a,b)=>a+b,0)!==order.amount_cents)throw Error('checkout_value_mismatch');
  if(order.status!=='paid'){
   const proof=await verifyCheckoutPayment(env,fetch,order);
   if(!proof)throw Error('provider_not_confirmed');
   await markPaid(env,order,'asaas_webhook:'+event.id,proof);
  }
 }else if(type==='CHECKOUT_CREATED'){
  if(!order)throw Error('checkout_not_found');
 }else if(type==='CHECKOUT_CANCELED'||type==='CHECKOUT_EXPIRED'){
  if(!order)throw Error('checkout_not_found');
  // An external expiry is not authorization to revoke a paid order.
  await exec(d,"UPDATE orders SET status=?,checkout_state=?,updated_at=? WHERE id=? AND status='pending'",type==='CHECKOUT_EXPIRED'?'expired':'canceled',type==='CHECKOUT_EXPIRED'?'expired':'canceled',now(),order.id);
 }else if(type==='PAYMENT_REFUNDED'){
  const pid=String(isObj(payload.payment).id||'');
  const row=pid?await one(d,"SELECT * FROM orders WHERE provider_payment_id=? AND payment_provider='asaas'",pid):null;
  if(!row)throw Error('refund_order_missing');
  await verifyPaymentEvent(env,fetch,row,pid,['REFUNDED']);
  const changed=await exec(d,"UPDATE orders SET status='refunded',updated_at=? WHERE id=? AND status='paid'",now(),row.id);
  if(changed.meta?.changes)await enqueue(env,row,'revoke');
 }else if(type==='SUBSCRIPTION_CREATED'){
  const sub=isObj(payload.subscription),ref=String(sub.externalReference||'');
  const row=ref?await one(d,"SELECT * FROM orders WHERE id=? AND payment_provider='asaas'",ref):null;
  if(!row)throw Error('subscription_owner_not_found');
  if(sub.id)await exec(d,'UPDATE orders SET subscription_id=?,updated_at=? WHERE id=?',String(sub.id),now(),row.id);
 }else if(type==='PAYMENT_RECEIVED'||type==='PAYMENT_CONFIRMED'){
  const incoming=isObj(payload.payment),sub=String(incoming.subscription||''),pid=String(incoming.id||'');
  const row=sub?await one(d,"SELECT * FROM orders WHERE subscription_id=? AND sale_type!='one_time' AND payment_provider='asaas'",sub):null;
  if(row&&row.status==='paid'&&pid!==row.provider_payment_id){
   await verifyPaymentEvent(env,fetch,row,pid,['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);
   await enqueue(env,row,'renew:'+pid);
  }
 }
}
async function queueWorker(env){
 const d=env.PAGAMENTO_ARTISYS_DB,clock=Date.now(),stamp=now();
 const events=await rows(d,"SELECT * FROM provider_events WHERE (status IN ('received','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<?) ORDER BY received_at LIMIT 20",clock,clock-120000);
 for(const item of events){
  const lease=await exec(d,"UPDATE provider_events SET status='processing',locked_at=? WHERE id=? AND ((status IN ('received','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<?))",clock,item.id,clock,clock-120000);
  if(!lease.meta?.changes)continue;
  try{
   await eventHandler(env,item);
   await exec(d,"UPDATE provider_events SET status='processed',last_error=NULL,processed_at=?,locked_at=0 WHERE id=?",now(),item.id);
  }catch(e){
   const n=item.attempts+1;
   await exec(d,"UPDATE provider_events SET status='failed',attempts=?,last_error=?,next_attempt_at=?,locked_at=0 WHERE id=?",n,String(e.message).slice(0,250),Date.now()+Math.min(3600000,30000*2**Math.min(n,6)),item.id);
  }
 }
 const jobs=await rows(d,"SELECT * FROM fulfillments WHERE (status IN ('pending','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<?) ORDER BY created_at LIMIT 20",Date.now(),Date.now()-120000);
 for(const job of jobs){
  const lease=await exec(d,"UPDATE fulfillments SET status='processing',locked_at=? WHERE id=? AND ((status IN ('pending','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<?))",Date.now(),job.id,Date.now(),Date.now()-120000);
  if(!lease.meta?.changes)continue;
  try{await deliver(env,job);}catch(e){
   const n=job.attempts+1;
   await exec(d,"UPDATE fulfillments SET status='failed',attempts=?,last_error=?,next_attempt_at=?,locked_at=0,updated_at=? WHERE id=?",n,String(e.message).slice(0,250),Date.now()+Math.min(3600000,30000*2**Math.min(n,6)),now(),job.id);
  }
 }
}
async function reconcilePending(env){
 const pending=await rows(env.PAGAMENTO_ARTISYS_DB,"SELECT * FROM orders WHERE payment_provider='asaas' AND checkout_id IS NOT NULL AND status='pending' ORDER BY updated_at LIMIT 12");
 for(const row of pending){
  try{const proof=await verifyCheckoutPayment(env,fetch,row);if(proof)await markPaid(env,row,'scheduled_reconciliation',proof);}
  catch(e){console.error('payment reconciliation failed',{orderId:row.id,error:String(e.message).slice(0,100)});}
 }
}
function cors(req,env){
 const origin=req.headers.get('origin');
 const allowed=String(env.PUBLIC_ORIGINS||'').split(',').map(x=>x.trim());
 return origin&&allowed.includes(origin)?{'access-control-allow-origin':origin,'vary':'Origin','access-control-allow-headers':'authorization,content-type,idempotency-key','access-control-allow-methods':'GET,POST,OPTIONS'}:{};
}
async function process(request,env,ctx){
 const path=new URL(request.url).pathname,method=request.method,d=env.PAGAMENTO_ARTISYS_DB,headers=cors(request,env);
 const allowedOrigin=!request.headers.get('origin')||Object.keys(headers).length>0;
 const send=(data,status=200)=>json(data,status,headers);
 if(method==='OPTIONS')return new Response(null,{status:allowedOrigin?204:403,headers});
 if(method==='GET'&&path==='/healthz'){
  await initialize(env);
  const count=await one(d,"SELECT COUNT(*) AS total FROM offers WHERE id IN ("+CATALOG_DRAFTS.map(()=>'?').join(',')+")",...CATALOG_DRAFTS.map(x=>x.id));
  return send({ok:true,service:'Pagamento ArtiSys',storage:'cloudflare-d1',gatewayConfigured:!!env.ASAAS_API_KEY,paymentsEnabled:env.PAYMENTS_ENABLED==='true',catalogDraftsLoaded:Number(count?.total||0)===67});
 }
 if(method==='GET'&&['/','/admin','/comprar','/pedido','/assets/style.css','/assets/admin.css','/assets/admin.js','/assets/checkout.js'].includes(path)){
  const asset=['/','/comprar','/pedido'].includes(path)?'/checkout.html':path==='/admin'?'/admin.html':path.replace('/assets/','/');
  const url=new URL(request.url);url.pathname=asset;url.search='';
  return env.PAGAMENTO_ARTISYS_ASSETS.fetch(new Request(url.toString(),{method:'GET'}));
 }
 if(!path.startsWith('/v1/'))return send({error:'not_found'},404);
 await initialize(env);
 if(method==='GET'&&path==='/v1/catalog')return send({offers:(await rows(d,"SELECT id,product_id,name,description,price_cents,currency,sale_type,delivery_mode FROM offers WHERE active=1 ORDER BY name")).map(x=>({id:x.id,productId:x.product_id,name:x.name,description:x.description,priceCents:x.price_cents,currency:x.currency,saleType:x.sale_type,deliveryMode:x.delivery_mode}))});
 if(method==='POST'&&path==='/v1/orders'){
  if(!allowedOrigin)throw fail('origin_not_allowed',403);
  const v=isObj(await read(request)),email=String(v.email||'').trim().toLowerCase(),name=String(v.name||'').trim().slice(0,120);
  const idem=String(request.headers.get('idempotency-key')||v.idempotencyKey||'');
  if(!validEmail(email)||!validId(v.offerId)||idem.length<16||idem.length>120)throw fail('invalid_order');
  const offer=await one(d,'SELECT * FROM offers WHERE id=? AND active=1',v.offerId);
  if(!offer)throw fail('offer_not_available',404);
  const existing=await one(d,'SELECT id FROM orders WHERE customer_email=? AND idem_key=?',email,idem);
  if(existing)throw fail('idempotency_key_already_used',409);
  const code=String(v.couponCode||'').trim().toUpperCase(),discount=code?await one(d,'SELECT * FROM coupons WHERE code=? AND active=1',code):null;
  if(code&&!discount)throw fail('invalid_coupon');
  const price=Math.max(1,Math.round(offer.price_cents*(100-(discount?.percent_off||0))/100));
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const id=uuid(),t=now();
  try{
   await exec(d,"INSERT INTO orders(id,offer_id,product_id,customer_email,customer_name,amount_cents,original_amount_cents,coupon_code,currency,sale_type,delivery_mode,artifact_name,access_hash,idem_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id,offer.id,offer.product_id,email,name,price,offer.price_cents,code||null,offer.currency,offer.sale_type,offer.delivery_mode,offer.artifact_name,await digest(secret),idem,t,t);
  }catch(e){if(String(e.message).includes('UNIQUE'))throw fail('idempotency_key_already_used',409);throw e;}
  return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',id)),orderAccessToken:secret},201);
 }
 const ord=path.match(/^\/v1\/orders\/([a-f0-9-]{36})(?:\/(checkout|download))?$/);
 if(ord){
  const row=await authorizedOrder(request,env,ord[1]);
  if(method==='GET'&&!ord[2])return send({order:publicOrder(row)});
  if(method==='GET'&&ord[2]==='download'){
   if(row.status!=='paid'||row.fulfillment_status!=='delivered'||row.delivery_mode!=='download'||!validArtifact(row.artifact_name))throw fail('download_not_ready',409);
   if(!env.PAGAMENTO_ARTISYS_ARQUIVOS)throw fail('storage_not_configured',503);
   const object=await env.PAGAMENTO_ARTISYS_ARQUIVOS.get('releases/'+row.artifact_name);
   if(!object)throw fail('artifact_missing',404);
   return new Response(object.body,{headers:{...headers,'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+row.artifact_name+'"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
  if(method==='POST'&&ord[2]==='checkout'){
   if(!allowedOrigin)throw fail('origin_not_allowed',403);
   const v=isObj(await read(request)),provider=String(v.provider||'');
   if(!['asaas','manual_pix'].includes(provider))throw fail('invalid_provider');
   if(row.status!=='pending'||['canceled','expired'].includes(row.checkout_state))throw fail('order_not_payable',409);
   if(row.payment_provider&&row.payment_provider!==provider)throw fail('provider_selected',409);
   if(row.checkout_state==='creating'||row.checkout_state==='verifying')throw fail('checkout_requires_reconciliation',409);
   if(row.checkout_url)return send({order:publicOrder(row),checkoutUrl:row.checkout_url});
   if(provider==='manual_pix'){
    if(!env.MANUAL_PIX_KEY||row.sale_type!=='one_time')throw fail('manual_pix_unavailable',503);
    await exec(d,"UPDATE orders SET payment_provider='manual_pix',checkout_state='awaiting_manual_payment',updated_at=? WHERE id=?",now(),row.id);
    return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',row.id)),manualPixKey:env.MANUAL_PIX_KEY,notice:'Confirmação administrativa obrigatória.'});
   }
   if(env.PAYMENTS_ENABLED!=='true')throw fail('payments_not_enabled',503);
   if(!env.ASAAS_API_KEY||!env.ASAAS_WEBHOOK_TOKEN||!env.PUBLIC_BASE_URL)throw fail('asaas_not_configured',503);
   const publicUri=new URL(env.PUBLIC_BASE_URL);
   if(publicUri.protocol!=='https:')throw fail('public_url_not_https',503);
   const taken=await exec(d,"UPDATE orders SET payment_provider='asaas',checkout_state='creating',updated_at=? WHERE id=? AND status='pending' AND (checkout_state='not_started')",now(),row.id);
   if(!taken.meta?.changes)throw fail('checkout_in_progress',409);
   try{
    const offer=await one(d,'SELECT * FROM offers WHERE id=?',row.offer_id);
    const checkout=await createCheckout(env,fetch,{...row,payment_provider:'asaas'},offer);
    await exec(d,"UPDATE orders SET checkout_id=?,checkout_url=?,checkout_state='ready',updated_at=? WHERE id=? AND checkout_state='creating'",checkout.id,checkout.link,now(),row.id);
    return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',row.id)),checkoutUrl:checkout.link});
   }catch(e){
    await exec(d,"UPDATE orders SET checkout_state='verifying',updated_at=? WHERE id=?",now(),row.id);
    await audit(d,'checkout_inconclusive',row.id,{reason:String(e.message).slice(0,90)});
    throw fail('checkout_requires_reconciliation',502);
   }
  }
 }
 if(method==='GET'&&path==='/v1/customer/purchases'){
  const h=await digest(headerToken(request)),order=await one(d,'SELECT * FROM orders WHERE access_hash=?',h);
  if(!order)throw fail('unauthorized',401);
  return send({purchases:[publicOrder(order)]});
 }
 if(method==='POST'&&path==='/v1/webhooks/asaas'){
  if(!env.ASAAS_WEBHOOK_TOKEN||env.ASAAS_WEBHOOK_TOKEN.length<32)throw fail('webhook_not_configured',503);
  if(!await safeEqual(request.headers.get('asaas-access-token'),env.ASAAS_WEBHOOK_TOKEN))throw fail('unauthorized',401);
  const v=isObj(await read(request));
  if(typeof v.id!=='string'||v.id.length>200||!v.id||typeof v.event!=='string'||!v.event)throw fail('invalid_event');
  await exec(d,"INSERT OR IGNORE INTO provider_events(id,event_type,payload,received_at) VALUES(?,?,?,?)",v.id,v.event,JSON.stringify(v),now());
  ctx.waitUntil(queueWorker(env).catch(e=>console.error('queue_error',String(e.message).slice(0,80))));
  return send({received:true});
 }
 if(path.startsWith('/v1/admin/')){
  const releaseRoute=path==='/v1/admin/system-releases'||path.startsWith('/v1/admin/system-releases/');
  // OIDC grants ONLY the release-binary API; all other admin paths require ADMIN_TOKEN.
  if(!releaseRoute||!(await verifyReleaseGithubOidc(request,fetch)))await admin(request,env);
  if(releaseRoute)return systemReleaseAdmin(request,env);
  if(method==='GET'&&path==='/v1/admin/asaas/diagnostic')return send(await diagnoseAsaas(env,fetch));
  if(method==='GET'&&path==='/v1/admin/summary'){
   const summary=await one(d,"SELECT count(*) AS orders,coalesce(sum(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS receivedCents,sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,sum(CASE WHEN status='refunded' THEN 1 ELSE 0 END) AS refunded FROM orders");
   const broken=await one(d,"SELECT count(*) AS count FROM provider_events WHERE status='failed'");
   let connections={};try{connections=isObj(JSON.parse(env.PRODUCT_CONNECTORS_JSON||'{}'));}catch{}
   return send({summary:{...summary,failedEvents:broken.count},integrations:Object.entries(connections).map(([productId,x])=>({productId,configured:!!(x?.url&&x?.secret)}))});
  }
  if(method==='GET'&&path==='/v1/admin/offers')return send({offers:await rows(d,'SELECT * FROM offers ORDER BY updated_at DESC LIMIT 200')});

  if(method==='GET'&&path==='/v1/admin/catalog-drafts/status'){
   const ids=CATALOG_DRAFTS.map(x=>x.id),existing=await rows(d,"SELECT id,active,price_cents,product_id FROM offers WHERE id IN ("+ids.map(()=>'?').join(',')+")",...ids);
   const dbById=new Map(existing.map(x=>[x.id,x]));
   return send({expected:CATALOG_DRAFTS.length,present:existing.length,missing:ids.filter(id=>!dbById.has(id)).length,published:existing.filter(x=>x.active===1).length,changed:CATALOG_DRAFTS.filter(x=>{const old=dbById.get(x.id);return old&&(old.price_cents!==x.priceCents||old.product_id!==x.productId);}).length});
  }
  if(method==='POST'&&path==='/v1/admin/catalog-drafts/import'){
   const result=await insertMissingCatalogDrafts(d);
   await audit(d,'catalog_draft_import',CATALOG_SOURCE,result);
   return send(result);
  }

  if(method==='POST'&&path==='/v1/admin/offers'){
   const v=isObj(await read(request)),id=String(v.id||''),pid=String(v.productId||''),price=Number(v.priceCents),sale=String(v.saleType||'one_time'),delivery=String(v.deliveryMode||'manual'),artifact=v.artifactName||null;
   if(!validId(id)||!validId(pid)||!String(v.name||'').trim()||!Number.isInteger(price)||price<1||price>100000000||!['one_time','monthly','yearly'].includes(sale)||!['manual','download','webhook'].includes(delivery)||(artifact&&!validArtifact(artifact)))throw fail('invalid_offer');
   await exec(d,"INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES(?,?,?,?,?,'BRL',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,sale_type=excluded.sale_type,delivery_mode=excluded.delivery_mode,artifact_name=excluded.artifact_name,active=excluded.active,updated_at=excluded.updated_at",
    id,pid,String(v.name).trim().slice(0,140),String(v.description||'').slice(0,500),price,sale,delivery,artifact,v.active?1:0,now(),now());
   return send({offer:await one(d,'SELECT * FROM offers WHERE id=?',id)});
  }
  if(method==='GET'&&path==='/v1/admin/coupons')return send({coupons:await rows(d,'SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200')});
  if(method==='POST'&&path==='/v1/admin/coupons'){
   const v=isObj(await read(request)),code=String(v.code||'').toUpperCase().trim(),pct=Number(v.percentOff);
   if(!/^[A-Z0-9_-]{3,30}$/.test(code)||!Number.isInteger(pct)||pct<1||pct>90)throw fail('invalid_coupon');
   await exec(d,"INSERT INTO coupons(code,percent_off,active,created_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET percent_off=excluded.percent_off,active=excluded.active",code,pct,v.active===false?0:1,now());
   return send({coupon:await one(d,'SELECT * FROM coupons WHERE code=?',code)});
  }
  if(method==='GET'&&path==='/v1/admin/orders')return send({orders:(await rows(d,'SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')).map(x=>({...publicOrder(x),customerEmail:x.customer_email,customerName:x.customer_name}))});
  if(method==='GET'&&path==='/v1/admin/events')return send({events:await rows(d,'SELECT id,event_type,status,attempts,last_error,received_at,processed_at FROM provider_events ORDER BY received_at DESC LIMIT 200')});
  if(method==='GET'&&path==='/v1/admin/fulfillments')return send({fulfillments:await rows(d,'SELECT id,order_id,action,status,attempts,last_error,updated_at FROM fulfillments ORDER BY created_at DESC LIMIT 200')});
  const action=path.match(/^\/v1\/admin\/orders\/([a-f0-9-]{36})\/(confirm-manual|deliver-manual|reconcile)$/);
  if(method==='POST'&&action){
   const row=await one(d,'SELECT * FROM orders WHERE id=?',action[1]);if(!row)throw fail('order_not_found',404);
   if(action[2]==='confirm-manual'){
    if(row.payment_provider!=='manual_pix'||row.status!=='pending')throw fail('manual_payment_not_pending',409);
    await markPaid(env,row,'manual_admin');ctx.waitUntil(queueWorker(env));return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',row.id))});
   }
   if(action[2]==='deliver-manual'){
    if(row.status!=='paid'||row.delivery_mode!=='manual')throw fail('manual_delivery_denied',409);
    await exec(d,"UPDATE fulfillments SET status='delivered',updated_at=? WHERE order_id=? AND action='activate'",now(),row.id);
    await exec(d,"UPDATE orders SET fulfillment_status='delivered',updated_at=? WHERE id=?",now(),row.id);
    return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',row.id))});
   }
   if(action[2]==='reconcile'){
    if(row.payment_provider!=='asaas'||!row.checkout_id)throw fail('checkout_missing',409);
    const proof=await verifyCheckoutPayment(env,fetch,row);
    if(proof&&row.status==='pending'){await markPaid(env,row,'admin_reconcile',proof);ctx.waitUntil(queueWorker(env));}
    return send({order:publicOrder(await one(d,'SELECT * FROM orders WHERE id=?',row.id)),providerStatus:proof?.status||'PENDING'});
   }
  }
  const replay=path.match(/^\/v1\/admin\/(events|fulfillments)\/([^/]+)\/replay$/);
  if(method==='POST'&&replay){
   const id=decodeURIComponent(replay[2]);
   const table=replay[1]==='events'?'provider_events':'fulfillments';
   await exec(d,"UPDATE "+table+" SET status=?,next_attempt_at=0,last_error=NULL WHERE id=?",table==='provider_events'?'received':'pending',id);
   ctx.waitUntil(queueWorker(env));return send({accepted:true},202);
  }
 }
 return send({error:'not_found'},404);
}
export default {
 async fetch(request,env,ctx){
  try{return await process(request,env,ctx);}
  catch(e){console.error('payment_api_error',String(e.message).slice(0,130));return json({error:e.status?e.message:'internal_error'},e.status||500,cors(request,env));}
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil((async()=>{await initialize(env);await reconcilePending(env);await queueWorker(env);})().catch(e=>console.error('scheduled_error',String(e.message).slice(0,120))));
  ctx.waitUntil((async()=>{await initialize(env);await initialCatalogImport(env);})().catch(e=>console.error('catalog_seed_error',String(e.message).slice(0,120))));
 }
};
