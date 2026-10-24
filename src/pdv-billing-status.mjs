// Read-only product-scoped status lookup. Reuses the existing billing connector
// secret; never grants a license, contacts Asaas or exposes buyer/access tokens.
export const pdvBillingStatusPath='/v1/integrations/pdv/billing-status';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const id=value=>typeof value==='string'&&/^[-_a-zA-Z0-9]{1,128}$/.test(value);
async function signature(secret,text){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return 'sha256='+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function pdvBillingStatus(request,env,lookup,{now=Date.now()}={}){
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 let secret;try{secret=JSON.parse(env.PRODUCT_CONNECTORS_JSON||'{}')['pdv-total-saas']?.secret;}catch{}
 if(typeof secret!=='string'||secret.length<32)return json({error:'billing_status_unavailable'},503);
 const timestamp=request.headers.get('x-artisys-timestamp')||'',sig=request.headers.get('x-artisys-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||!/^sha256=[a-f0-9]{64}$/.test(sig))return json({error:'unauthorized'},401);
 if(Number(request.headers.get('content-length')||0)>16000)return json({error:'request_too_large'},413);
 const raw=await request.text();if(raw.length>16000)return json({error:'request_too_large'},413);
 const expected=await signature(secret,timestamp+'.'+pdvBillingStatusPath+'.'+raw);
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);
 if(diff)return json({error:'unauthorized'},401);
 let payload;try{payload=JSON.parse(raw);}catch{return json({error:'invalid_request'},400);}
 if(!id(payload?.tenantId)||!Array.isArray(payload.orders)||payload.orders.length>50||
   payload.orders.some(o=>!id(o?.orderId)||!id(o?.userId))||new Set(payload.orders.map(o=>o.orderId)).size!==payload.orders.length)
  return json({error:'invalid_request'},400);
 const orders=[];
 for(const item of payload.orders){
  const row=await lookup(item.orderId);
  let binding;try{
   const part=row?.binding?.split('.')[0];
   const decoded=atob(part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4));
   binding=JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded,c=>c.charCodeAt(0))));
  }catch{}
  if(row?.product_id!=='pdv-total-saas'||binding?.v!==1||binding.tenantId!==payload.tenantId||binding.userId!==item.userId){
   orders.push({orderId:item.orderId,status:'unavailable'});continue;
  }
  orders.push({orderId:item.orderId,status:row.status,checkoutState:row.checkout_state,fulfillmentStatus:row.fulfillment_status});
 }
 return json({orders,checkedAt:new Date(now).toISOString()});
}
