import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CATALOG_DRAFTS} from '../src/catalog-drafts.mjs';
import {SYSTEMS,defaultSystemVariant} from '../src/delivery-catalog.mjs';
import {publishVerifiedSystems,SYSTEM_OFFER_ROLLOUT} from '../src/system-offer-publication.mjs';

const BASE='https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE offers(
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  price_cents INTEGER NOT NULL, currency TEXT, sale_type TEXT, delivery_mode TEXT,
  artifact_name TEXT, active INTEGER NOT NULL, created_at TEXT, updated_at TEXT);
  CREATE TABLE audit_logs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const prepare=(sql,args=[])=>({
  bind(...items){return prepare(sql,items);},
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:result.changes}};}
 });
 const db={prepare,batch:async statements=>{
  sqlite.exec('BEGIN');
  try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
 const releases=new Map();
 for(const draft of CATALOG_DRAFTS.filter(x=>SYSTEMS.has(x.id))){
  const first=defaultSystemVariant(draft.id);
  sqlite.prepare("INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES(?,?,?,?,?,'BRL','one_time','download',?,0,'2026-10-10','2026-10-10')")
   .run(draft.id,draft.productId,draft.name,draft.description,draft.priceCents,first.key.slice('releases/'.length));
 }
 for(const group of SYSTEMS.values())for(const release of group)releases.set(release.key,{
  size:release.size,customMetadata:{sha256:release.sha256}
 });
 sqlite.prepare("INSERT INTO offers(id,product_id,name,description,price_cents,currency,sale_type,delivery_mode,artifact_name,active,created_at,updated_at) VALUES('artisys-demo-kit','artisys-demo-kit','Kit preservado','',1000,'BRL','one_time','download','kit.zip',1,'2026-10-10','2026-10-10')").run();
 const env={PAGAMENTO_ARTISYS_DB:db,PAGAMENTO_ARTISYS_ARQUIVOS:{head:async key=>releases.get(key)||null},
   PAYMENTS_ENABLED:'true',ASAAS_API_KEY:'fixture-key',ASAAS_API_BASE_URL:'https://api.asaas.com/v3',
   ASAAS_WEBHOOK_TOKEN:'x'.repeat(40),PUBLIC_BASE_URL:BASE};
 const provider=async url=>{
  if(url.endsWith('/wallets/'))return new Response('{}',{status:200});
  if(url.includes('/webhooks?'))return new Response(JSON.stringify({data:[{
   url:BASE+'/v1/webhooks/asaas',enabled:true,interrupted:false,
   events:['CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED']
  }],hasMore:false}),{status:200});
  throw Error('Unexpected provider request '+url);
 };
 const state=()=>sqlite.prepare("SELECT id,active,price_cents,delivery_mode,artifact_name FROM offers ORDER BY id").all();
 return {sqlite,env,releases,provider,state};
}

test('publica somente os quatro sistemas, com todas as 8 variantes válidas, sem alterar kits, preços ou versões',async()=>{
 const f=fixture(),before=f.state();
 const result=await publishVerifiedSystems(f.env,f.provider);
 assert.equal(result.published,true,JSON.stringify(result));
 const after=f.state();
 for(const row of after.filter(x=>SYSTEMS.has(x.id))){
  const previous=before.find(x=>x.id===row.id);
  assert.deepEqual({...row,active:0},{...previous});
  assert.equal(row.active,1);
 }
 assert.deepEqual({...after.find(x=>x.id==='artisys-demo-kit')},{...before.find(x=>x.id==='artisys-demo-kit')});
 const audit=f.sqlite.prepare("SELECT * FROM audit_logs WHERE kind='system_offers_published' AND subject_id=?").get(SYSTEM_OFFER_ROLLOUT);
 assert.ok(audit);
 assert.deepEqual(JSON.parse(audit.details).sort(),[...SYSTEMS.keys()].sort());
});

test('não ativa nenhum sistema se variante R2 faltar, preço divergente ou Asaas indisponível',async()=>{
 for(const broken of ['missing_release','price_changed','payments_disabled','webhook_disabled']){
  const f=fixture();
  if(broken==='missing_release')f.releases.delete([...SYSTEMS.values()][0][0].key);
  if(broken==='price_changed')f.sqlite.prepare("UPDATE offers SET price_cents=42 WHERE id='pdv-nexus'").run();
  if(broken==='payments_disabled')f.env.PAYMENTS_ENABLED='false';
  const fetcher=broken==='webhook_disabled'
   ? async url=>url.includes('/webhooks?')?new Response(JSON.stringify({data:[{url:BASE+'/v1/webhooks/asaas',enabled:false,interrupted:false,events:[]}]}),{status:200}):f.provider(url)
   :f.provider;
  const result=await publishVerifiedSystems(f.env,fetcher);
  assert.equal(result.published,false,broken);
  assert.ok(f.state().filter(x=>SYSTEMS.has(x.id)).every(x=>x.active===0),broken);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,0,broken);
 }
});

test('publicação é uma única vez e nunca reativa oferta desabilitada manualmente',async()=>{
 const f=fixture();
 assert.equal((await publishVerifiedSystems(f.env,f.provider)).published,true);
 f.sqlite.prepare("UPDATE offers SET active=0 WHERE id='pdv-nexus'").run();
 const next=await publishVerifiedSystems(f.env,async()=>{throw Error('Asaas não pode ser chamado após rollout')});
 assert.equal(next.published,false);
 assert.equal(next.reason,'already_published');
 assert.equal(f.sqlite.prepare("SELECT active FROM offers WHERE id='pdv-nexus'").get().active,0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,1);
});
