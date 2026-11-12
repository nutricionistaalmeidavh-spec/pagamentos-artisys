import {verifyBridgeHmac} from './core.mjs';
const NATIVE_PRODUCTS=Object.freeze({'ARTISYS-PDV-DESKTOP':'PDV','ARTISYS-OFICINA-DESKTOP':'OFICINA'});
const reply=(status,body)=>({status,body});
const validEmail=(value)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||''))&&String(value).length<=254;
const validUUID=(value)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
const trim=(value,max)=>String(value??'').trim().slice(0,max);
const validBase=(value)=>{
 let u;try{u=new URL(value)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
 return u;
};
async function api(fetchImpl,base,path,{method='GET',body,cookie}={}){
 const response=await fetchImpl(new URL(path,base),{method,headers:{
   accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})
 },...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(response.status>=300&&response.status<400)throw Error('native_redirect_rejected');
 return response;
}
async function session(fetchImpl,base,token){
 const response=await api(fetchImpl,base,'/v1/admin/session',{method:'POST',body:{token}});
 if(response.status!==204)throw Error('native_admin_auth_rejected');
 const cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
 if(!/^__Host-artisys_admin_session=[A-Za-z0-9_-]+$/.test(cookie))throw Error('native_session_invalid');
 return cookie;
}
export async function handlePdvNativeDelivery({core,config={},raw,timestamp,signature,fetchImpl=fetch}){
 if(!config.pdvBridgeSecret||!config.pdvNativeAdminToken||!config.pdvNativeBaseUrl)
   return reply(503,{accepted:false,error:'pdv_native_not_configured'});
 if(!verifyBridgeHmac(raw,timestamp,signature,config.pdvBridgeSecret))
   return reply(401,{accepted:false,error:'invalid_signature'});
 const base=validBase(config.pdvNativeBaseUrl);
 if(!base||String(config.pdvNativeAdminToken).length<32)
   return reply(503,{accepted:false,error:'native_configuration_invalid'});
 let data;
 try{data=JSON.parse(Buffer.from(raw).toString('utf8'))}catch{return reply(400,{error:'invalid_json'})}
 const payload=data?.payload,event=data?.event,sku=trim(payload?.sku,90),product=NATIVE_PRODUCTS[sku];
 const licenseId=trim(payload?.licenseId,80),buyerEmail=trim(payload?.email,254).toLowerCase();
 if(!product||!['product.grant','product.revoke'].includes(event)||!validUUID(licenseId)||
    (event==='product.grant'&&!validEmail(buyerEmail)))
   return reply(422,{accepted:false,error:'invalid_native_event'});
 const db=core.db;
 const current=db.prepare('SELECT * FROM native_pdv_links WHERE license_id=?').get(licenseId);
 if(current&&(current.sku!==sku||current.product!==product))
   return reply(409,{accepted:false,error:'license_identity_conflict'});
 if(event==='product.grant'){
   if(current?.status==='active')return reply(200,{accepted:true,activationCode:core.decryptSecret(current.code_secret)});
   if(current)return reply(409,{accepted:false,error:'native_manual_reconciliation_required'});
   // Reserva durável antes da chamada externa: qualquer ambiguidade impede um segundo POST
   // que poderia cancelar uma licença pertencente a outro pedido.
   const reserved=db.prepare(
      "INSERT OR IGNORE INTO native_pdv_links(license_id,sku,product,native_id,email,code_secret,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
       .run(licenseId,sku,product,'',buyerEmail,'','pending',new Date().toISOString(),new Date().toISOString());
   if(!reserved.changes)return reply(409,{accepted:false,error:'native_concurrent_provisioning'});
   try{
     const cookie=await session(fetchImpl,base,config.pdvNativeAdminToken);
     const list=await api(fetchImpl,base,'/v1/admin/licenses',{cookie});
     if(!list.ok)throw Error('native_license_lookup_failed');
     const body=await list.json();
     const active=(Array.isArray(body?.licenses)?body.licenses:[]).some(lic=>
       String(lic?.email||'').toLowerCase()===buyerEmail && String(lic?.product||'PDV').toUpperCase()===product && lic?.status==='ACTIVE');
     if(active)return reply(409,{accepted:false,error:'preexisting_license_requires_review'});
     const created=await api(fetchImpl,base,'/v1/admin/licenses',{cookie,method:'POST',body:{email:buyerEmail,product}});
     if(created.status!==201)return reply(409,{accepted:false,error:'native_license_rejected'});
     const native=await created.json();
     if(!native?.licenseId||!/^\d{6}$/.test(String(native.code||'')))
       return reply(502,{accepted:false,error:'native_license_response_incomplete'});
     db.prepare("UPDATE native_pdv_links SET native_id=?,code_secret=?,status='active',updated_at=? WHERE license_id=? AND status='pending'")
       .run(String(native.licenseId),core.encryptSecret(String(native.code)),new Date().toISOString(),licenseId);
     return reply(200,{accepted:true,activationCode:String(native.code),codeExpiresAt:native.codeExpiresAt||null});
   }catch{return reply(503,{accepted:false,error:'native_service_unavailable_or_requires_reconciliation'})}
 }
 if(!current)return reply(200,{accepted:true,alreadyAbsent:true});
 if(current.status==='revoked')return reply(200,{accepted:true,alreadyRevoked:true});
 if(current.status!=='active'||!current.native_id)return reply(409,{accepted:false,error:'native_manual_reconciliation_required'});
 try{
   const cookie=await session(fetchImpl,base,config.pdvNativeAdminToken);
   const changed=await api(fetchImpl,base,'/v1/admin/licenses/'+encodeURIComponent(current.native_id),
     {cookie,method:'PATCH',body:{status:'CANCELLED'}});
   if(!changed.ok)return reply(503,{accepted:false,error:'native_revoke_unconfirmed'});
   const out=await changed.json();
   if(out?.updated!==true||String(out?.id)!==current.native_id)return reply(503,{accepted:false,error:'native_revoke_unconfirmed'});
   db.prepare("UPDATE native_pdv_links SET status='revoked',updated_at=? WHERE license_id=?")
     .run(new Date().toISOString(),licenseId);
   return reply(200,{accepted:true});
 }catch{return reply(503,{accepted:false,error:'native_service_unavailable_or_requires_reconciliation'})}
}
