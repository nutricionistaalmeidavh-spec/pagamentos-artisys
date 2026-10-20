import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/cloudflare-worker.mjs';
import {PDV_SAAS_PRODUCT_ID,PDV_SAAS_OFFER_TEMPLATES,pdvSaasTemplatesPending,validPdvSaasOffer} from '../src/pdv-saas-offers.mjs';
import {offerCategory,commercialTemplatesPending,HUB_COURSE_TEMPLATES} from '../src/hub-course-catalog.mjs';

const ADMIN='test-central-admin-token-with-more-than-32-chars';
function d1(){
 const db=new DatabaseSync(':memory:');
 const statement=(sql,args=[])=>({
  bind(...values){return statement(sql,values);},
  async first(){return db.prepare(sql).get(...args)||null;},
  async all(){return {results:db.prepare(sql).all(...args)};},
  async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}};}
 });
 return {raw:db,prepare:sql=>statement(sql),batch:queries=>Promise.all(queries.map(q=>q.run()))};
}
function context(){
 const tasks=[];
 return {waitUntil(t){tasks.push(t)},async flush(){while(tasks.length)await Promise.all(tasks.splice(0))}};
}
test('PDV TOTAL uses central Asaas product IDs and explicitly approved R$89 / R$899 prices',()=>{
 assert.equal(PDV_SAAS_PRODUCT_ID,'pdv-total-saas');
 assert.equal(PDV_SAAS_OFFER_TEMPLATES.length,2);
 assert.deepEqual(PDV_SAAS_OFFER_TEMPLATES.map(x=>[x.id,x.priceCents,x.saleType]),[
  ['pdv-total-saas-mensal',8900,'monthly'],['pdv-total-saas-anual',89900,'yearly']]);
 for(const offer of PDV_SAAS_OFFER_TEMPLATES){
  assert.equal(offer.productId,PDV_SAAS_PRODUCT_ID);
  assert.equal(offer.active,false);
  assert.equal(offer.deliveryMode,'webhook');
  assert.equal(offer.artifactName,null);
  assert.equal(offer.category,'sistemas');
  assert.equal(offerCategory({id:offer.id,product_id:offer.productId}),'sistemas');
  assert.equal(validPdvSaasOffer(offer.id,offer.productId,offer.saleType,'webhook',null),true);
  assert.equal(validPdvSaasOffer(offer.id,offer.productId,'one_time','webhook',null),false);
  assert.equal(validPdvSaasOffer(offer.id,offer.productId,offer.saleType,'download','setup.exe'),false);
 }
 assert.equal(validPdvSaasOffer('some-other-id',PDV_SAAS_PRODUCT_ID,'monthly','webhook',null),false);
 assert.equal(validPdvSaasOffer('pdv-nexus','pdv-nexus','one_time','download','setup.exe'),true);
});
test('commercial catalog retains HubEstudos, systems and DevKits, and hides only registered PDV plan templates',()=>{
 const pending=commercialTemplatesPending([]);
 assert.equal(pending.length,HUB_COURSE_TEMPLATES.length+2);
 assert.equal(pending.filter(x=>x.category==='sistemas').length,2);
 assert.equal(commercialTemplatesPending([{id:'pdv-total-saas-mensal'}]).filter(x=>x.category==='sistemas').length,1);
 assert.equal(pdvSaasTemplatesPending(PDV_SAAS_OFFER_TEMPLATES).length,0);
 assert.equal(offerCategory({id:'artisys-qa',product_id:'artisys-qa'}),'devkits');
 assert.equal(offerCategory({id:'obra-na-mao',product_id:'obra-na-mao'}),'sistemas');
 assert.equal(offerCategory({id:'trilha-pentest-ethical-hacking',product_id:'hubestudos-course-trilha-pentest-ethical-hacking'}),'cursos');
});
test('Cloudflare cron seeds only inactive PDV plans without overwriting existing records; public catalog excludes drafts',async()=>{
 const env={PAGAMENTO_ARTISYS_DB:d1(),ADMIN_TOKEN:ADMIN,PAYMENTS_ENABLED:'false'};
 const ctx=context();
 // First initialize through the same production Worker.
 let r=await worker.fetch(new Request('https://checkout.example/healthz'),env,ctx);
 assert.equal(r.status,200);
 const old=new Date().toISOString();
 env.PAGAMENTO_ARTISYS_DB.raw.prepare("INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES(?,?,?,?,?,'BRL','monthly','webhook',NULL,0,?,?)")
  .run('pdv-total-saas-mensal',PDV_SAAS_PRODUCT_ID,'Existing user draft','Custom',7500,old,old);
 await worker.scheduled({},env,ctx);await ctx.flush();
 const saved=env.PAGAMENTO_ARTISYS_DB.raw.prepare("SELECT id,price_cents,active,sale_type,delivery_mode FROM offers WHERE product_id=? ORDER BY id").all(PDV_SAAS_PRODUCT_ID);
 assert.equal(saved.length,2);
 assert.deepEqual(saved.map(x=>[x.id,x.price_cents,x.active]),[
  ['pdv-total-saas-anual',89900,0],['pdv-total-saas-mensal',7500,0]]);
 const list=await worker.fetch(new Request('https://checkout.example/v1/catalog'),env,ctx);
 assert.equal(list.status,200);
 assert.equal((await list.json()).offers.some(x=>x.productId===PDV_SAAS_PRODUCT_ID),false);
 const admin=await worker.fetch(new Request('https://checkout.example/v1/admin/offers',{headers:{authorization:'Bearer '+ADMIN}}),env,ctx);
 assert.equal(admin.status,200);
 const data=await admin.json();
 assert.equal(data.offers.filter(x=>x.product_id===PDV_SAAS_PRODUCT_ID).length,2);
 assert.equal(data.templates.filter(x=>x.category==='sistemas').length,0);
 await worker.scheduled({},env,ctx);await ctx.flush();
 assert.equal(env.PAGAMENTO_ARTISYS_DB.raw.prepare('SELECT COUNT(*) AS n FROM offers WHERE product_id=?').get(PDV_SAAS_PRODUCT_ID).n,2);
 env.PAGAMENTO_ARTISYS_DB.raw.close();
});
