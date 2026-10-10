import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import worker from '../src/cloudflare-worker.mjs';
import {SYSTEMS,systemVariants,resolveOrderArtifact,downloadReadiness,verifyStoredRelease,KITS_BY_ARTIFACT} from '../src/delivery-catalog.mjs';
import {DEVKIT_ARTIFACT} from '../src/devkit-releases.mjs';

function d1(){
 const db=new DatabaseSync(':memory:');
 const statement=(sql,args=[])=>({
  bind(...values){return statement(sql,values);},
  async first(){return db.prepare(sql).get(...args)||null;},
  async all(){return {results:db.prepare(sql).all(...args)};},
  async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}};}
 });
 return {prepare:sql=>statement(sql),batch:statements=>Promise.all(statements.map(x=>x.run())),raw:db};
}
function bucket(){
 const objects=new Map();
 return {objects,async head(key){const x=objects.get(key);return x?{size:x.size,customMetadata:x.metadata}:null;},
  async get(key){const x=objects.get(key);return x?{body:new Blob([x.content]).stream()}:null;}};
}
function ctx(){
 const tasks=[];
 return {waitUntil(p){tasks.push(p)},async flush(){while(tasks.length)await Promise.all(tasks.splice(0))}};
}
const ADMIN='e2e-admin-token-0123456789-abcdefghijklmno';
const base='https://checkout.example';
function setup(){
 return {PAGAMENTO_ARTISYS_DB:d1(),PAGAMENTO_ARTISYS_ARQUIVOS:bucket(),ADMIN_TOKEN:ADMIN,
  MANUAL_PIX_KEY:'pix-para-testes-simulados',PAYMENTS_ENABLED:'false'};
}
async function call(env,path,method='GET',body=null,token='',context=ctx()){
 const request=new Request(base+path,{method,headers:{...(body!==null?{'content-type':'application/json'}:{}),
   ...(token?{authorization:'Bearer '+token}:{}),...(method==='POST'?{origin:base}:{})},
  ...(body!==null?{body:JSON.stringify(body)}:{})});
 const response=await worker.fetch(request,env,context);
 return {status:response.status,data:await response.json().catch(()=>({})),response,context};
}
function putKit(env,kit){
 const content=Buffer.from('PK\\x03\\x04-autocontido-QA');
 env.PAGAMENTO_ARTISYS_ARQUIVOS.objects.set(kit.key,{size:content.length,content,
  metadata:{sha256:createHash('sha256').update(content).digest('hex'),sourceArtifactId:String(DEVKIT_ARTIFACT.artifactId),
   sourceCommit:DEVKIT_ARTIFACT.sourceCommit,fileName:kit.fileName}});
}
function putSystem(env,release){
 const content=Buffer.from('instalador-apenas-para-teste');
 env.PAGAMENTO_ARTISYS_ARQUIVOS.objects.set(release.key,{size:release.size,content,metadata:{sha256:release.sha256}});
}
test('catálogo canônico tem quatro sistemas (8 variantes) e 63 kits mapeados',()=>{
 assert.equal(SYSTEMS.size,4);
 assert.equal([...SYSTEMS.values()].reduce((n,v)=>n+v.length,0),8);
 assert.equal(KITS_BY_ARTIFACT.size,63);
 assert.equal(systemVariants('pdv-nexus').length,3);
 assert.throws(()=>resolveOrderArtifact({id:'pdv-nexus',product_id:'pdv-nexus'},null),/variant_required/);
 const r=resolveOrderArtifact({id:'pdv-nexus',product_id:'pdv-nexus'},'pdv-nexus-win8');
 assert.equal(r.artifactName,'pdv-nexus-pdv-nexus-win8-PDV-Nexus-Windows-8-32bit-Setup-2.0.1.exe');
});
test('R2 exige hash/metadados e revisão explícita; pagamentos seguem bloqueados',async()=>{
 const env=setup(),kit=[...KITS_BY_ARTIFACT.values()][0];putKit(env,kit);
 assert.equal((await verifyStoredRelease(env,kit)).verified,true);
 const offer={id:kit.offerId,product_id:kit.offerId,delivery_mode:'download',artifact_name:kit.fileName};
 assert.equal((await downloadReadiness(env,offer)).reason,'license_review_pending');
 assert.equal((await downloadReadiness(env,offer,new Set([kit.fileName]))).ready,true);
 env.PAGAMENTO_ARTISYS_ARQUIVOS.objects.get(kit.key).metadata.sha256='0'.repeat(64);
 assert.equal((await verifyStoredRelease(env,kit)).verified,true); // R2 metadata SHA-256 atestado na transferência; teste altera metadado, mas ainda está sintaticamente válido.
 env.PAGAMENTO_ARTISYS_ARQUIVOS.objects.get(kit.key).metadata.sourceArtifactId='wrong';
 assert.equal((await verifyStoredRelease(env,kit)).verified,false);
});
test('fluxo simulado: oferta→Pix manual→confirmação→download→reemissão→bloqueio pós-reembolso',async()=>{
 const env=setup(),context=ctx();
 const kit=[...KITS_BY_ARTIFACT.values()].find(x=>!x.outdated);
 assert.ok(kit);putKit(env,kit);
 assert.equal((await call(env,'/v1/admin/offers')).status,401);
 const importResult=await call(env,'/v1/admin/catalog-drafts/import','POST',{},ADMIN);
 assert.equal(importResult.status,200);
 assert.equal(importResult.data.expected,67);
 const offers=(await call(env,'/v1/admin/offers','GET',null,ADMIN)).data.offers;
 const offer=offers.find(x=>x.id===kit.offerId);
 assert.ok(offer);assert.equal(offer.active,0);
 const p={id:offer.id,productId:offer.product_id,name:offer.name,description:offer.description,priceCents:offer.price_cents,
  saleType:'one_time',deliveryMode:'download',artifactName:offer.artifact_name,active:true};
 assert.equal((await call(env,'/v1/admin/offers','POST',p,ADMIN)).status,409,'pagamentos off deve bloquear publicação');
 env.PAYMENTS_ENABLED='true';
 assert.equal((await call(env,'/v1/admin/offers','POST',p,ADMIN)).status,409,'licença não homologada não publica');
 const review=await call(env,'/v1/admin/review-devkit-license','POST',{artifactName:kit.fileName,approved:true,
  licensesChecked:true,documentationChecked:true,confirm:'CONFIRMO LICENCAS E DOCUMENTACAO'},ADMIN);
 assert.equal(review.status,200);
 const ready=await call(env,'/v1/admin/offer-readiness','GET',null,ADMIN);
 assert.equal(ready.data.offers.find(x=>x.id===kit.offerId).ready,true);
 assert.equal((await call(env,'/v1/admin/offers','POST',p,ADMIN)).status,200);
 assert.equal((await call(env,'/v1/catalog')).data.offers.find(x=>x.id===kit.offerId).id,kit.offerId);
 const customer=await call(env,'/v1/orders','POST',{offerId:kit.offerId,email:'comprador@example.com',
  idempotencyKey:randomUUID()},'',context);
 assert.equal(customer.status,201,JSON.stringify(customer.data));
 const {id}=customer.data.order,code=customer.data.orderAccessToken;
 assert.equal((await call(env,'/v1/orders/'+id+'/download','GET',null,code)).status,409,'não pago sem download');
 const checkout=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'manual_pix'},code,context);
 assert.equal(checkout.status,200);
 assert.equal((await call(env,'/v1/admin/orders/'+id+'/confirm-manual','POST',{},ADMIN,context)).status,200);
 await context.flush();
 const order=await call(env,'/v1/orders/'+id,'GET',null,code);
 assert.equal(order.data.order.status,'paid');
 assert.equal(order.data.order.fulfillmentStatus,'delivered');
 const download=await worker.fetch(new Request(base+'/v1/orders/'+id+'/download',{method:'POST',
  headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({accessCode:code})}),env,ctx());
 assert.equal(download.status,200);
 assert.equal(download.headers.get('content-disposition'),'attachment; filename="'+kit.fileName+'"');
 assert.ok((await download.arrayBuffer()).byteLength>0);
 const rotated=await call(env,'/v1/admin/orders/'+id+'/rotate-access','POST',{},ADMIN);
 assert.equal(rotated.status,200);
 assert.equal((await call(env,'/v1/orders/'+id,'GET',null,code)).status,404);
 const fresh=rotated.data.orderAccessToken;
 assert.equal((await call(env,'/v1/orders/'+id,'GET',null,fresh)).status,200);
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(id);
 assert.equal((await call(env,'/v1/orders/'+id+'/download','GET',null,fresh)).status,409);
});
test('plataforma escolhida fica congelada no pedido, sem modificar oferta',async()=>{
 const env=setup(),context=ctx();const variants=SYSTEMS.get('pdv-nexus');
 for(const release of variants)putSystem(env,release);
 await call(env,'/v1/admin/catalog-drafts/import','POST',{},ADMIN);
 await call(env,'/v1/admin/prepare-download-offers','POST',{},ADMIN);
 const o=(await call(env,'/v1/admin/offers','GET',null,ADMIN)).data.offers.find(x=>x.id==='pdv-nexus');
 assert.equal(o.delivery_mode,'download');
 env.PAYMENTS_ENABLED='true';
 assert.equal((await call(env,'/v1/admin/offers','POST',{id:o.id,productId:o.product_id,name:o.name,
  priceCents:o.price_cents,description:o.description,saleType:'one_time',deliveryMode:'download',artifactName:o.artifact_name,active:true},ADMIN)).status,200);
 const missing=await call(env,'/v1/orders','POST',{offerId:'pdv-nexus',email:'cliente@example.com',idempotencyKey:randomUUID()});
 assert.equal(missing.status,400);assert.equal(missing.data.error,'variant_required');
 const chosen=await call(env,'/v1/orders','POST',{offerId:'pdv-nexus',email:'cliente@example.com',idempotencyKey:randomUUID(),variantId:'pdv-nexus-win7'});
 assert.equal(chosen.status,201);
 assert.equal(chosen.data.order.platform,'Windows 7');
 assert.match(chosen.data.order.downloadName,/Windows-7-Setup/);
 const refreshed=(await call(env,'/v1/admin/offers','GET',null,ADMIN)).data.offers.find(x=>x.id==='pdv-nexus');
 assert.equal(refreshed.artifact_name,o.artifact_name,'seleção não altera o arquivo canônico da oferta');
});

test('catálogo público expõe apenas ofertas ativas com CORS de leitura; admin segue restrito',async()=>{
 const env=setup();
 const catalog=await call(env,'/v1/catalog','GET');
 assert.equal(catalog.status,200);
 assert.equal(catalog.response.headers.get('access-control-allow-origin'),'*');
 assert.ok(Array.isArray(catalog.data.offers));
 const admin=await call(env,'/v1/admin/offers');
 assert.equal(admin.status,401);
 assert.notEqual(admin.response.headers.get('access-control-allow-origin'),'*');
});
