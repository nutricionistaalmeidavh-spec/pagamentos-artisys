import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/cloudflare-worker.mjs';

test('sem D1 o worker falha fechado',async()=>{
 const res=await worker.fetch(new Request('https://example.org/healthz'),{}, {waitUntil(){}});
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,'d1_not_configured');
});
test('painel usa assets do worker',async()=>{
 let path='';
 const env={ASSETS:{fetch:async req=>{path=new URL(req.url).pathname;return new Response('ok');}}};
 const res=await worker.fetch(new Request('https://example.org/admin'),env,{waitUntil(){}});
 assert.equal(res.status,200);
 assert.equal(path,'/admin.html');
});
test('wrangler inclui worker, D1, R2 e cron',()=>{
 const cfg=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(cfg.name,'pagamentos-artisys');
 assert.equal(cfg.main,'src/cloudflare-worker.mjs');
 assert.ok(cfg.d1_databases.some(x=>x.binding==='DB'));
 assert.ok(cfg.r2_buckets.some(x=>x.binding==='FILES'));
 assert.ok(cfg.triggers.crons.includes('*/5 * * * *'));
 assert.equal(cfg.assets.run_worker_first,true);
});
