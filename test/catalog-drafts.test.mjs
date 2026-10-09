import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_DRAFTS} from '../src/catalog-drafts.mjs';
import worker from '../src/cloudflare-worker.mjs';
test('catálogo contém exatamente 63 Dev Kits e 4 sistemas, IDs únicos e 67 rascunhos',()=>{
 assert.equal(CATALOG_DRAFTS.length,67);
 assert.equal(new Set(CATALOG_DRAFTS.map(x=>x.id)).size,67);
 assert.ok(CATALOG_DRAFTS.every(x=>x.active===false&&x.saleType==='one_time'&&x.priceCents>0));
 assert.equal(CATALOG_DRAFTS.filter(x=>x.deliveryMode==='download').length,63);
 assert.equal(CATALOG_DRAFTS.filter(x=>x.deliveryMode==='manual').length,4);
 assert.ok(CATALOG_DRAFTS.filter(x=>x.deliveryMode==='download').every(x=>x.artifactName?.endsWith('.zip')));
});
test('preços finais correspondem ao intervalo 19,90 a 99,99 dos kits',()=>{
 const p=CATALOG_DRAFTS.slice(0,63).map(x=>x.priceCents);
 assert.equal(Math.min(...p),1990);
 assert.equal(Math.max(...p),9999);
 assert.deepEqual(CATALOG_DRAFTS.slice(63).map(x=>x.priceCents),[3990,8990,16990,29990]);
});
test('ID técnico do kit e preços dos sistemas permanecem estáveis',()=>{
 assert.equal(CATALOG_DRAFTS[0].id,'artisys-qa');
 assert.equal(CATALOG_DRAFTS[0].priceCents,3853);
 assert.equal(CATALOG_DRAFTS[45].id,'artisys-finance-domain');
 assert.equal(CATALOG_DRAFTS[45].priceCents,9999);
 assert.deepEqual(CATALOG_DRAFTS.slice(63).map(x=>x.id),['pdv-nexus','pdv-artisys-restaurantes','artisys-sistema-financeiro','obra-na-mao']);
});
test('importação administrativa exige token, mesmo sem pedidos e sem gateway',async()=>{
 const db={
  batch:async()=>[],
  prepare(){return{bind(){return this;},all:async()=>({results:[]}),first:async()=>null,run:async()=>({meta:{changes:0}})};}
 };
 const env={PAGAMENTO_ARTISYS_DB:db,ADMIN_TOKEN:'this-is-a-test-admin-token-012345678901'};
 const res=await worker.fetch(new Request('https://test.local/v1/admin/catalog-drafts/import',{method:'POST'}),env,{waitUntil(){}});
 assert.equal(res.status,401);
 assert.equal((await res.json()).error,'unauthorized');
});
