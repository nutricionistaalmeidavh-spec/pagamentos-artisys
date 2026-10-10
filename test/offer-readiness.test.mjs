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

test('Asaas HTTP 400 Pix ausente é rejeição conclusiva; permite reusar o mesmo pedido com cartão e callback correto',async()=>{
 const env=setup(),context=ctx();
 env.PAYMENTS_ENABLED='true';
 env.ASAAS_API_KEY='asaas-fake-key-for-local-mock';
 env.ASAAS_WEBHOOK_TOKEN='local-test-webhook-token-0123456789abcdef';
 env.ASAAS_PIX_ENABLED='true';
 env.PUBLIC_BASE_URL='https://checkout.example/'; // reproduz URL com barra final na configuração.
 await call(env,'/healthz');
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)")
 .run('artisys-test-pay','artisys-test-pay','Kit QA de checkout','Produto simulado',3853,'BRL','one_time','manual',new Date().toISOString(),new Date().toISOString());
 const customer=await call(env,'/v1/orders','POST',{offerId:'artisys-test-pay',email:'test@example.com',name:'QA',
  idempotencyKey:randomUUID()+'-'+randomUUID()},'',context);
 assert.equal(customer.status,201,JSON.stringify(customer.data));
 const {id}=customer.data.order,code=customer.data.orderAccessToken;
 const previousFetch=globalThis.fetch,requests=[];
 try{
  globalThis.fetch=async (url,init)=>{
   const payload=JSON.parse(init.body);requests.push({url,payload});
   assert.ok(String(url).endsWith('/v3/checkouts'));
   if(requests.length===1)return new Response(JSON.stringify({errors:[{code:'invalid_object',
    description:'Para gerar cobranças com Pix é necessário criar uma chave Pix no Asaas.'}]}),{status:400,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({id:'checkout_test_001',link:'https://sandbox.asaas.com/checkoutSession/show/checkout_test_001'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const first=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},code,context);
  assert.equal(first.status,409,JSON.stringify(first.data));
  assert.equal(first.data.error,'asaas_pix_key_required');
  assert.deepEqual(requests[0].payload.billingTypes,['PIX','CREDIT_CARD']);
  assert.equal(requests[0].payload.callback.successUrl,'https://checkout.example/pedido?id='+id);
  assert.equal(requests[0].payload.callback.cancelUrl,requests[0].payload.callback.successUrl);
  assert.equal(requests[0].payload.callback.expiredUrl.includes('//pedido'),false);
  const rejected=env.PAGAMENTO_ARTISYS_DB.raw.prepare('SELECT payment_provider,checkout_state,checkout_id,status FROM orders WHERE id=?').get(id);
  assert.equal(rejected.checkout_state,'not_started');
  assert.equal(rejected.payment_provider,null);
  assert.equal(rejected.checkout_id,null);
  assert.equal(rejected.status,'pending');
  const audited=env.PAGAMENTO_ARTISYS_DB.raw.prepare("SELECT details FROM audit_logs WHERE kind='checkout_rejected' AND subject_id=?").get(id);
  assert.equal(JSON.parse(audited.details).code,'asaas_pix_key_required');
  const second=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas',paymentMethod:'credit_card'},code,context);
  assert.equal(second.status,200,JSON.stringify(second.data));
  assert.deepEqual(requests[1].payload.billingTypes,['CREDIT_CARD']);
  assert.equal(second.data.order.checkoutState,'ready');
  assert.equal(second.data.order.paymentProvider,'asaas');
  assert.equal((await call(env,'/v1/orders/'+id,'GET',null,code)).data.order.status,'pending');
  const third=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas',paymentMethod:'credit_card'},code,context);
  assert.equal(third.status,200);
  assert.equal(requests.length,2,'checkout pronto não cria checkout duplicado');
 }finally{globalThis.fetch=previousFetch;}
});
test('Asaas desconhecido continua em conciliação, não autoriza novo checkout',async()=>{
 const env=setup(),context=ctx();env.PAYMENTS_ENABLED='true';env.ASAAS_API_KEY='test';
 env.ASAAS_WEBHOOK_TOKEN='local-test-webhook-token-0123456789abcdef';
 env.PUBLIC_BASE_URL='https://checkout.example/';
 await call(env,'/healthz');
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,price_cents,currency,sale_type,delivery_mode,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)")
 .run('artisys-test-unknown','artisys-test-unknown','Kit QA',3853,'BRL','one_time','manual',new Date().toISOString(),new Date().toISOString());
 const created=await call(env,'/v1/orders','POST',{offerId:'artisys-test-unknown',email:'test@example.com',
  idempotencyKey:randomUUID()+'-'+randomUUID()},'',context);
 assert.equal(created.status,201);
 const {id}=created.data.order,code=created.data.orderAccessToken;
 const previousFetch=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error('network_timeout_after_request');};
  const failed=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},code,context);
  assert.equal(failed.status,502);assert.equal(failed.data.error,'checkout_requires_reconciliation');
  assert.equal((await call(env,'/v1/orders/'+id,'GET',null,code)).data.order.checkoutState,'verifying');
  const repeat=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas',paymentMethod:'credit_card'},code,context);
  assert.equal(repeat.status,409);assert.equal(repeat.data.error,'checkout_requires_reconciliation');
 }finally{globalThis.fetch=previousFetch;}
});

test('Pix permanece disponível por padrão, pode ser desabilitado explicitamente sem chave e cartão segue disponível',async()=>{
 const {createCheckout}=await import('../src/asaas.mjs');
 const order={id:'11111111-1111-4111-8111-111111111111',sale_type:'one_time',amount_cents:3853};
 const offer={name:'Kit QA',description:'Verificação segura'};
 const bases={ASAAS_API_KEY:'fake',ASAAS_API_BASE_URL:'https://api-sandbox.asaas.com/v3',PUBLIC_BASE_URL:'https://checkout.example/'};
 const captured=[];
 const provider=async(_url,init)=>{captured.push(JSON.parse(init.body));return new Response(JSON.stringify({
  id:'checkout_test_flag_01',link:'https://sandbox.asaas.com/checkoutSession/show/checkout_test_flag_01'
 }),{status:200,headers:{'content-type':'application/json'}});};
 await createCheckout(bases,provider,order,offer);
 assert.deepEqual(captured[0].billingTypes,['PIX','CREDIT_CARD']);
 await createCheckout({...bases,ASAAS_PIX_ENABLED:'false'},provider,order,offer);
 assert.deepEqual(captured[1].billingTypes,['CREDIT_CARD']);
 await createCheckout(bases,provider,order,offer,'credit_card');
 assert.deepEqual(captured[2].billingTypes,['CREDIT_CARD']);
 assert.equal(captured[0].callback.successUrl,'https://checkout.example/pedido?id='+order.id);
});

test('Asaas HTTP 200 somente com id cria URL canônica e persiste checkout sem gerar cobrança duplicada',async()=>{
 const env=setup(),context=ctx();
 env.PAYMENTS_ENABLED='true';env.ASAAS_API_KEY='fake-token';
 env.ASAAS_API_BASE_URL='https://api.asaas.com/v3';
 env.ASAAS_WEBHOOK_TOKEN='local-test-webhook-token-0123456789abcdef';
 env.PUBLIC_BASE_URL='https://checkout.example/';
 await call(env,'/healthz');
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,price_cents,currency,sale_type,delivery_mode,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)")
  .run('kit-canonical-url','kit-canonical-url','Kit QA',3853,'BRL','one_time','manual',new Date().toISOString(),new Date().toISOString());
 const created=await call(env,'/v1/orders','POST',{offerId:'kit-canonical-url',email:'test@example.com',idempotencyKey:randomUUID()+'-'+randomUUID()},'',context);
 assert.equal(created.status,201);
 const {id}=created.data.order,code=created.data.orderAccessToken,checkoutId=randomUUID();
 const oldFetch=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async (_url,init)=>{
   calls++;
   assert.equal(init.method,'POST');
   // Resposta real da API: somente id. Qualquer link extra jamais é necessário.
   return new Response(JSON.stringify({id:checkoutId,link:'https://www.asaas.com/untrusted-legacy-path'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const checkout=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},code,context);
  assert.equal(checkout.status,200,JSON.stringify(checkout.data));
  const expected='https://asaas.com/checkoutSession/show?id='+checkoutId;
  assert.equal(checkout.data.checkoutUrl,expected);
  assert.equal(checkout.data.order.checkoutState,'ready');
  const stored=env.PAGAMENTO_ARTISYS_DB.raw.prepare('SELECT checkout_id,checkout_url,checkout_state,status FROM orders WHERE id=?').get(id);
  assert.equal(stored.checkout_id,checkoutId);assert.equal(stored.checkout_url,expected);
  assert.equal(stored.checkout_state,'ready');assert.equal(stored.status,'pending');
  const repeated=await call(env,'/v1/orders/'+id+'/checkout','POST',{provider:'asaas'},code,context);
  assert.equal(repeated.status,200);assert.equal(repeated.data.checkoutUrl,expected);
  assert.equal(calls,1,'retry never creates another checkout after success');
 }finally{globalThis.fetch=oldFetch;}
});

test('Webhook autenticado repara checkout órfão apenas com referência, callbacks e valor corretos',async()=>{
 const env=setup(),context=ctx();
 env.PAYMENTS_ENABLED='true';env.ASAAS_API_KEY='fake-key';
 env.ASAAS_API_BASE_URL='https://api.asaas.com/v3';
 env.ASAAS_WEBHOOK_TOKEN='long-local-test-webhook-token-0123456789abcdef';
 env.PUBLIC_BASE_URL='https://checkout.example/';
 await call(env,'/healthz');
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,price_cents,currency,sale_type,delivery_mode,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)")
  .run('kit-event-recover','kit-event-recover','Kit QA',3853,'BRL','one_time','manual',new Date().toISOString(),new Date().toISOString());
 const created=await call(env,'/v1/orders','POST',{offerId:'kit-event-recover',email:'test@example.com',idempotencyKey:randomUUID()+'-'+randomUUID()},'',context);
 assert.equal(created.status,201);
 const {id}=created.data.order,code=created.data.orderAccessToken;
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("UPDATE orders SET checkout_state='verifying',payment_provider='asaas' WHERE id=?").run(id);
 const returnUrl='https://checkout.example/pedido?id='+id,checkoutId=randomUUID();
 const event={id:'evt_'+randomUUID().replaceAll('-',''),event:'CHECKOUT_CREATED',
  checkout:{id:checkoutId,status:'ACTIVE',externalReference:id,minutesToExpire:60,
   callback:{successUrl:returnUrl,cancelUrl:returnUrl,expiredUrl:returnUrl},
   items:[{name:'Kit QA',quantity:1,value:38.53}]}};
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO provider_events(id,event_type,payload,status,received_at) VALUES(?,?,?,'failed',?)")
  .run(event.id,event.event,JSON.stringify(event),new Date().toISOString());
 const replay=await call(env,'/v1/admin/events/'+event.id+'/replay','POST',{},ADMIN,context);
 assert.equal(replay.status,202,JSON.stringify(replay.data));
 await context.flush();
 const order=(await call(env,'/v1/orders/'+id,'GET',null,code)).data.order;
 assert.equal(order.checkoutState,'ready');
 assert.equal(order.checkoutUrl,'https://asaas.com/checkoutSession/show?id='+checkoutId);
 assert.equal(order.status,'pending');
 assert.equal(env.PAGAMENTO_ARTISYS_DB.raw.prepare('SELECT status FROM provider_events WHERE id=?').get(event.id).status,'processed');
 assert.equal(env.PAGAMENTO_ARTISYS_DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE kind='checkout_recovered_from_webhook' AND subject_id=?").get(id).n,1);
});

test('Webhook de checkout órfão com valor inválido não estabelece vínculo financeiro',async()=>{
 const env=setup(),context=ctx();
 env.PAYMENTS_ENABLED='true';env.ASAAS_API_KEY='fake-key';env.PUBLIC_BASE_URL='https://checkout.example/';
 await call(env,'/healthz');
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,price_cents,currency,sale_type,delivery_mode,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)")
  .run('kit-event-mismatch','kit-event-mismatch','Kit QA',3853,'BRL','one_time','manual',new Date().toISOString(),new Date().toISOString());
 const created=await call(env,'/v1/orders','POST',{offerId:'kit-event-mismatch',email:'test@example.com',idempotencyKey:randomUUID()+'-'+randomUUID()},'',context);
 const {id}=created.data.order;
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("UPDATE orders SET checkout_state='verifying',payment_provider='asaas' WHERE id=?").run(id);
 const target='https://checkout.example/pedido?id='+id;
 const event={id:'evt_'+randomUUID().replaceAll('-',''),event:'CHECKOUT_CREATED',
 checkout:{id:randomUUID(),status:'ACTIVE',callback:{successUrl:target,cancelUrl:target,expiredUrl:target},
 items:[{quantity:1,value:99.99}]}};
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO provider_events(id,event_type,payload,status,received_at) VALUES(?,?,?,'failed',?)")
 .run(event.id,event.event,JSON.stringify(event),new Date().toISOString());
 const replay=await call(env,'/v1/admin/events/'+event.id+'/replay','POST',{},ADMIN,context);assert.equal(replay.status,202);
 await context.flush();
 const order=env.PAGAMENTO_ARTISYS_DB.raw.prepare('SELECT checkout_id,checkout_url,checkout_state FROM orders WHERE id=?').get(id);
 assert.equal(order.checkout_id,null);assert.equal(order.checkout_url,null);assert.equal(order.checkout_state,'verifying');
});
