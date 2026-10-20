// Private backend delegation to PDV TOTAL. No Asaas or ADMIN_TOKEN credential crosses Workers.
const enc=new TextEncoder();
function problem(message,status=503){throw Object.assign(new Error(message),{status});}
export async function forwardPdvPlatformAdmin(env,payload,{fetchImpl=fetch,now=Date.now,nonce=()=>crypto.randomUUID()}={}){
 let url;try{url=new URL(String(env?.PDV_TOTAL_PLATFORM_URL||''));}catch{problem('pdv_platform_url_invalid');}
 if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)problem('pdv_platform_url_invalid');
 const secret=env?.ARTISYS_PLATFORM_BRIDGE_SECRET;
 if(typeof secret!=='string'||secret.length<32)problem('pdv_platform_secret_not_configured');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['summary','tenants','audit','approve','bootstrap'].includes(payload.action))
  problem('pdv_platform_action_denied',403);
 if(payload.action==='approve'&&(typeof payload.tenantId!=='string'||!/^[-_a-zA-Z0-9]{1,128}$/.test(payload.tenantId)))
  problem('pdv_platform_tenant_invalid',400);
 if(payload.action==='bootstrap'&&(!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data)))
  problem('pdv_platform_bootstrap_invalid',400);
 const plain=JSON.stringify(payload),timestamp=String(now()),id=nonce();
 if(plain.length>8192)problem('pdv_platform_request_too_large',413);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))problem('pdv_platform_nonce_invalid');
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(timestamp+'.'+id+'.'+plain)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const response=await fetchImpl(url.origin+'/api/v1/integrations/artisys/platform',{method:'POST',
  headers:{'content-type':'application/json','x-artisys-platform-timestamp':timestamp,
   'x-artisys-platform-nonce':id,'x-artisys-platform-signature':'sha256='+sig},
  body:plain,redirect:'error',signal:AbortSignal.timeout(8000)});
 const result=await response.text();
 if(result.length>100000)problem('pdv_platform_response_too_large',502);
 return new Response(result,{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
