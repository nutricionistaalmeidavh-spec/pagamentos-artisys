// Worker independente: somente calculadora, assets listados e validação de token via Service Binding.
// Não usa banco, Asaas, R2 ou variáveis financeiras da Central de Pagamentos.
const CENTRAL='https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev';
const files=new Map([
 ['/','/precificador.html'],
 ['/precificar','/precificador.html'],
 ['/assets/precificador.css','/precificador.css'],
 ['/assets/precificador.js','/precificador.js'],
 ['/assets/precificador-engine.js','/precificador-engine.js']
]);
const plain=(status,message)=>new Response(JSON.stringify({error:message}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const securityHeaders={
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='GET'&&files.has(path)){
   if(!env.PRECIFICADOR_ASSETS)return plain(503,'assets_not_configured');
   const target=new URL(request.url);target.pathname=files.get(path);target.search='';
   const asset=await env.PRECIFICADOR_ASSETS.fetch(new Request(target.toString(),{method:'GET'}));
   const headers=new Headers(asset.headers);
   for(const [key,value] of Object.entries(securityHeaders))headers.set(key,value);
   headers.set('cache-control','no-store');
   return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
  }
  if(request.method==='GET'&&path==='/v1/admin/summary'){
   const auth=String(request.headers.get('authorization')||'');
   if(!/^Bearer \S{1,512}$/.test(auth))return plain(401,'unauthorized');
   if(!env.PAGAMENTOS_CENTRAL)return plain(503,'central_not_configured');
   try{
    const upstream=await env.PAGAMENTOS_CENTRAL.fetch(new Request(CENTRAL+'/v1/admin/summary',{method:'GET',headers:{authorization:auth,'cache-control':'no-store'}}));
    if(upstream.status===401||upstream.status===403)return plain(401,'unauthorized');
    if(!upstream.ok)return plain(503,'central_unavailable');
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...securityHeaders}});
   }catch{return plain(503,'central_unavailable')}
  }
  return plain(404,'not_found');
 }
};
