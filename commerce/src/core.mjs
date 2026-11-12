import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHmac,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';

const stamp=()=>new Date().toISOString();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sha=(v)=>createHash('sha256').update(String(v)).digest('hex');
const trim=(v,max=254)=>String(v??'').trim().slice(0,max);
const email=(v)=>trim(v).toLowerCase();
const validEmail=(v)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254;
const validSku=(v)=>/^[A-Z0-9][A-Z0-9_-]{1,90}$/.test(String(v??''));
const safeEqual=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y)};
export const createLicenseKey=()=>[...randomBytes(16)].map(b=>ALPHABET[b%32]).join('');
export const verifyShopifyHmac=(raw,header,secret)=>!!secret&&!!header&&safeEqual(createHmac('sha256',secret).update(raw).digest('base64'),header);
export function verifyBridgeHmac(raw,timestamp,header,secret,now=Date.now()){
  if(!secret||!/^\d{13}$/.test(String(timestamp??''))||Math.abs(now-Number(timestamp))>300000)return false;
  return safeEqual('sha256='+createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest('hex'),header);
}
export function normalizeShopifyOrder(p,topic,shop,eventId){
  const order=p&&typeof p==='object'?p:{};
  if(!['orders/paid','orders/cancelled','refunds/create'].includes(topic))throw Error('unsupported_shopify_topic');
  return {source:'shopify',seller:shop,eventId,externalOrderId:trim(topic==='refunds/create'?(order.order_id||order.id):order.id,80),
    event:topic==='orders/paid'?'paid':topic==='orders/cancelled'?'cancelled':'refund_review',
    paymentConfirmed:order.financial_status==='paid'&&!order.cancelled_at,
    email:email(order.contact_email||order.email||order.customer?.email),
    name:trim([order.customer?.first_name,order.customer?.last_name].filter(Boolean).join(' ')||order.billing_address?.name||'',160),
    currency:trim(order.currency||'BRL',8),
    lines:(Array.isArray(order.line_items)?order.line_items:[]).map(l=>({id:trim(l.id,80),sku:trim(l.sku,90).toUpperCase(),quantity:Number(l.quantity)}))};
}
const schema=[
 'PRAGMA foreign_keys=ON',
 "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,channel TEXT NOT NULL,seller TEXT NOT NULL,external_id TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',buyer_name TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'BRL',status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(channel,seller,external_id))",
 "CREATE TABLE IF NOT EXISTS entitlements(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),sku TEXT NOT NULL,seat INTEGER NOT NULL,code_hash TEXT NOT NULL UNIQUE,code_secret TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',activation_status TEXT NOT NULL DEFAULT 'awaiting_connector',max_devices INTEGER NOT NULL DEFAULT 1,native_code_secret TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(order_id,sku,seat))",
 "CREATE TABLE IF NOT EXISTS events(channel TEXT NOT NULL,event_id TEXT NOT NULL,event_type TEXT NOT NULL,order_id TEXT,created_at TEXT NOT NULL,PRIMARY KEY(channel,event_id))",
 "CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ref TEXT NOT NULL,payload_secret TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(kind,ref))",
 "CREATE TABLE IF NOT EXISTS portal_tokens(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at TEXT,created_at INTEGER NOT NULL)",
 "CREATE TABLE IF NOT EXISTS portal_sessions(session_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS native_pdv_links(license_id TEXT PRIMARY KEY,sku TEXT NOT NULL,product TEXT NOT NULL,native_id TEXT NOT NULL,email TEXT NOT NULL,code_secret TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
 'CREATE INDEX IF NOT EXISTS entitlements_order ON entitlements(order_id)',
 'CREATE INDEX IF NOT EXISTS orders_email ON orders(email)',
 'CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status,created_at)'
].join(';')+';';

export function createCore({dbPath=':memory:',masterKey,catalog={},clock=Date.now,publicBaseUrl=''}={}){
  const key=Buffer.from(String(masterKey??''),'base64');
  if(key.length!==32)throw Error('LICENSE_MASTER_KEY must contain 32 random bytes encoded in base64');
  const db=new DatabaseSync(dbPath);db.exec(schema);
  if(!db.prepare('PRAGMA table_info(entitlements)').all().some(x=>x.name==='native_code_secret'))db.exec('ALTER TABLE entitlements ADD COLUMN native_code_secret TEXT');
  const products=Object.fromEntries(Object.entries(catalog).filter(([sku,p])=>validSku(sku)&&p&&typeof p==='object'&&Number.isInteger(p.maxDevices)&&p.maxDevices>=1&&p.maxDevices<=100));
  const encrypt=(value)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    const enc=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),enc.toString('base64url')].join('.')};
  const decrypt=(secret)=>{const [iv,tag,data]=String(secret??'').split('.');
    if(!iv||!tag||!data)throw Error('invalid_ciphertext');
    const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
    cipher.setAuthTag(Buffer.from(tag,'base64url'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8'))};
  const txn=(fn)=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
  function enqueue(kind,ref,payload){
    db.prepare('INSERT OR IGNORE INTO outbox(id,kind,ref,payload_secret,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(),kind,ref,encrypt(payload),'pending',stamp(),stamp());
  }
  function receive(v){
    const channel=trim(v.source,36),seller=trim(v.seller,170),orderKey=trim(v.externalOrderId,80),eventId=trim(v.eventId,160),event=trim(v.event,36);
    if(!/^[a-z][a-z0-9_-]*$/.test(channel)||!seller||!orderKey||!eventId||!['paid','pending','cancelled','refund_review'].includes(event))throw Error('invalid_order_event');
    return txn(()=>{
      const result=db.prepare('INSERT OR IGNORE INTO events(channel,event_id,event_type,created_at) VALUES(?,?,?,?)').run(channel,eventId,event,stamp());
      if(!result.changes)return {duplicate:true,created:0};
      let order=db.prepare('SELECT * FROM orders WHERE channel=? AND seller=? AND external_id=?').get(channel,seller,orderKey);
      const buyer=email(v.email||order?.email);
      if(!order){
        const id=randomUUID();
        db.prepare('INSERT INTO orders(id,channel,seller,external_id,email,buyer_name,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(id,channel,seller,orderKey,validEmail(buyer)?buyer:'',trim(v.name,160),trim(v.currency||'BRL',8),'pending',stamp(),stamp());
        order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      }
      db.prepare('UPDATE events SET order_id=? WHERE channel=? AND event_id=?').run(order.id,channel,eventId);
      if(event==='refund_review'){enqueue('payment.refund_review',order.id+':'+eventId,{source:channel,seller,orderKey,eventId});return {duplicate:false,created:0,review:true}}
      if(event==='cancelled'){
        db.prepare("UPDATE orders SET status='cancelled',updated_at=? WHERE id=?").run(stamp(),order.id);
        // Uma compra cancelada não pode liberar uma licença ainda presa na outbox.
        db.prepare("UPDATE outbox SET status='superseded',updated_at=? WHERE kind='product.grant' AND status!='sent' AND ref IN (SELECT id FROM entitlements WHERE order_id=?)").run(stamp(),order.id);
        db.prepare("UPDATE entitlements SET status='revoked',activation_status='revocation_pending',updated_at=? WHERE order_id=? AND status!='revoked'").run(stamp(),order.id);
        for(const lic of db.prepare('SELECT id,sku FROM entitlements WHERE order_id=?').all(order.id))
          enqueue('product.revoke',lic.id,{licenseId:lic.id,sku:lic.sku,source:channel,orderId:orderKey});
        enqueue('crm.sale_revoked',order.id,{source:channel,externalOrderId:orderKey,email:order.email});
        return {duplicate:false,created:0,revoked:true};
      }
      if(event==='pending'||v.paymentConfirmed!==true||order.status==='cancelled'||!validEmail(buyer))
        return {duplicate:false,created:0,pendingReview:event==='paid'&&!validEmail(buyer)};
      if(order.status!=='paid')db.prepare("UPDATE orders SET status='paid',email=?,buyer_name=?,currency=?,updated_at=? WHERE id=?").run(buyer,trim(v.name||order.buyer_name,160),trim(v.currency||order.currency,8),stamp(),order.id);
      let created=0;
      // Carrinhos podem ter várias linhas com o mesmo SKU: somar assentos antes da deduplicação.
      const quantities=new Map();
      for(const line of Array.isArray(v.lines)?v.lines.slice(0,80):[]){
        const sku=trim(line.sku,90).toUpperCase(),qty=Number(line.quantity);
        if(!products[sku]||!Number.isSafeInteger(qty)||qty<1||qty>20)continue;
        quantities.set(sku,(quantities.get(sku)||0)+qty);
      }
      if([...quantities.values()].some(q=>q>100)||[...quantities.values()].reduce((a,b)=>a+b,0)>200)throw Error('quantity_requires_manual_review');
      for(const [sku,qty] of quantities){
        const product=products[sku];
        for(let seat=1;seat<=qty;seat++){
          if(db.prepare('SELECT id FROM entitlements WHERE order_id=? AND sku=? AND seat=?').get(order.id,sku,seat))continue;
          const id=randomUUID(),code=createLicenseKey();
          db.prepare('INSERT INTO entitlements(id,order_id,sku,seat,code_hash,code_secret,max_devices,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(id,order.id,sku,seat,sha(code),encrypt(code),product.maxDevices,stamp(),stamp());
          enqueue('product.grant',id,{licenseId:id,sku,orderId:orderKey,channel,seller,email:buyer,code,seat,maxDevices:product.maxDevices,productKey:trim(product.productKey||sku,90)});
          created++;
        }
      }
      if(created){
        enqueue('crm.sale',order.id,{source:channel,externalOrderId:orderKey,email:buyer,buyerName:trim(v.name,160),
          skus:db.prepare('SELECT sku FROM entitlements WHERE order_id=?').all(order.id).map(r=>r.sku)});
        if(publicBaseUrl){const link=createPortalLink(buyer,publicBaseUrl);if(link)enqueue('portal.email',sha(link),{email:buyer,link})}
      }
      return {duplicate:false,created,status:'paid'};
    });
  }
  function listLicenses(buyerEmail){
    const who=email(buyerEmail);if(!validEmail(who))return [];
    return db.prepare('SELECT e.*,o.channel,o.external_id FROM entitlements e JOIN orders o ON o.id=e.order_id WHERE o.email=? ORDER BY e.created_at DESC')
      .all(who).map(r=>({id:r.id,sku:r.sku,code:decrypt(r.code_secret),status:r.status,activationStatus:r.activation_status,
        maxDevices:r.max_devices,activationCode:r.native_code_secret?decrypt(r.native_code_secret):null,createdAt:r.created_at,source:r.channel,orderId:r.external_id,downloadUrl:products[r.sku]?.downloadUrl||null}));
  }
  function createPortalLink(buyerEmail,baseUrl){
    const who=email(buyerEmail);
    if(!validEmail(who)||!db.prepare('SELECT 1 FROM entitlements e JOIN orders o ON o.id=e.order_id WHERE o.email=? LIMIT 1').get(who))return null;
    const url=new URL(baseUrl);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('portal_base_url_must_be_https');
    const token=randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO portal_tokens(token_hash,email,expires_at,created_at) VALUES(?,?,?,?)').run(sha(token),who,clock()+900000,clock());
    const link=new URL('/portal/claim',url);link.searchParams.set('token',token);return link.toString();
  }
  function requestPortalAccess(buyerEmail,baseUrl){
    const who=email(buyerEmail);
    const recent=db.prepare('SELECT created_at FROM portal_tokens WHERE email=? ORDER BY created_at DESC LIMIT 1').get(who);
    if(recent&&clock()-Number(recent.created_at)<120000)return {queued:false};
    const link=createPortalLink(who,baseUrl);
    if(!link)return {queued:false};
    enqueue('portal.email',sha(link),{email:who,link});return {queued:true};
  }
  function consumePortalToken(token){
    return txn(()=>{
      const hash=sha(trim(token,160));
      const row=db.prepare('SELECT email FROM portal_tokens WHERE token_hash=? AND expires_at>? AND used_at IS NULL').get(hash,clock());
      if(!row)return null;
      const result=db.prepare('UPDATE portal_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(stamp(),hash);
      if(!result.changes)return null;
      const session=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO portal_sessions(session_hash,email,expires_at,created_at) VALUES(?,?,?,?)')
        .run(sha(session),row.email,clock()+7*24*3600000,stamp());return session;
    });
  }
  const sessionEmail=(token)=>token?db.prepare('SELECT email FROM portal_sessions WHERE session_hash=? AND expires_at>?').get(sha(token),clock())?.email||null:null;
  const logout=(token)=>db.prepare('DELETE FROM portal_sessions WHERE session_hash=?').run(sha(token));
  const listJobs=(limit=100)=>db.prepare('SELECT id,kind,ref,status,attempts,last_error,created_at FROM outbox ORDER BY created_at,id LIMIT ?').all(Math.max(1,Math.min(250,Number(limit)||100)));
  const pendingJobs=(limit=10)=>db.prepare("SELECT * FROM outbox WHERE status IN ('pending','retry','waiting_configuration') AND attempts<15 ORDER BY created_at LIMIT ?")
    .all(Math.max(1,Math.min(50,Number(limit)||10))).map(row=>({...row,payload:decrypt(row.payload_secret)}));
  const markJob=(id,status,error='')=>{
    if(!['sent','retry','waiting_configuration'].includes(status))throw Error('invalid_job_status');
    db.prepare('UPDATE outbox SET status=?,attempts=attempts+?,last_error=?,updated_at=? WHERE id=?').run(status,status==='waiting_configuration'?0:1,String(error).slice(0,220),stamp(),id);
  };
  const nativeAccepted=(job,answer={})=>{if(!['product.grant','product.revoke'].includes(job.kind))return;
    const activationCode=trim(answer.activationCode,120);
    db.prepare('UPDATE entitlements SET activation_status=?,native_code_secret=?,updated_at=? WHERE id=?')
      .run(job.kind==='product.grant'?'provisioned':'revoked',activationCode?encrypt(activationCode):null,stamp(),job.ref)};
  return {db,catalog:products,receive,listLicenses,createPortalLink,requestPortalAccess,consumePortalToken,sessionEmail,logout,listJobs,pendingJobs,markJob,nativeAccepted,encryptSecret:encrypt,decryptSecret:decrypt,close:()=>db.close()};
}
export async function dispatchJobs(core,config,{fetchImpl=fetch,limit=10}={}){
  const out=[];
  for(const job of core.pendingJobs(limit)){
    if(job.kind==='payment.refund_review'){core.markJob(job.id,'waiting_configuration','requires_manual_refund_review');continue}
    const target=job.kind.startsWith('product.')?config.productConnectors?.[job.payload.sku]:
      job.kind.startsWith('crm.')?config.crmConnector:job.kind==='portal.email'?config.mailConnector:null;
    if(!target?.url||!target?.secret){core.markJob(job.id,'waiting_configuration','connector_not_configured');continue}
    let url;
    try{url=new URL(target.url)}catch{core.markJob(job.id,'waiting_configuration','invalid_connector_url');continue}
    if(url.username||url.password||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))){
      core.markJob(job.id,'waiting_configuration','connector_requires_https_or_loopback');continue}
    const raw=JSON.stringify({event:job.kind,deliveryId:job.id,payload:job.payload}),timestamp=String(Date.now());
    const signature='sha256='+createHmac('sha256',target.secret).update(timestamp+'.'+raw).digest('hex');
    try{
      const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',
        'x-artisys-timestamp':timestamp,'x-artisys-delivery-id':job.id,'x-artisys-signature':signature},
        body:raw,signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('connector_http_'+response.status);
      const answer=await response.json().catch(()=>({}));
      if(answer.accepted!==true)throw Error('connector_ack_missing');
      if(job.kind==='product.grant'&&!String(answer.activationCode||'').trim()&&!target.acceptsCoreCode)throw Error('native_activation_code_missing');
      core.markJob(job.id,'sent');core.nativeAccepted(job,answer);out.push({id:job.id,status:'sent'});
    }catch(error){core.markJob(job.id,'retry',error?.message||'delivery_failed');out.push({id:job.id,status:'retry'})}
  }
  return out;
}
