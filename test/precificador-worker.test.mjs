import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/cloudflare-worker.mjs';
import {existsSync,readFileSync} from 'node:fs';

const assets=()=>({PAGAMENTO_ARTISYS_ASSETS:{fetch:async req=>new Response(new URL(req.url).pathname)}});
test('precificador tem rota isolada e não depende de D1 para carregar a interface',async()=>{
 const res=await worker.fetch(new Request('https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/precificar'),assets(),{waitUntil(){}});
 assert.equal(res.status,200);
 assert.equal(await res.text(),'/precificador.html');
});
test('raiz tradicional da central continua checkout',async()=>{
 const res=await worker.fetch(new Request('https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/'),assets(),{waitUntil(){}});
 assert.equal(await res.text(),'/checkout.html');
});
test('recursos da ferramenta têm mapeamento explícito',async()=>{
 for(const name of ['precificador.css','precificador.js','precificador-engine.js']){
  const res=await worker.fetch(new Request('https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/assets/'+name),assets(),{waitUntil(){}});
  assert.equal(res.status,200);
  assert.equal(await res.text(),'/'+name);
 }
});

test('precificador utiliza somente o Worker oficial de pagamentos',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(config.name,'pagamentos-artisys-central');
 assert.equal(config.main,'src/cloudflare-worker.mjs');
 assert.equal(existsSync(new URL('../wrangler.precificador.jsonc',import.meta.url)),false);
 assert.equal(existsSync(new URL('../src/precificador-worker.mjs',import.meta.url)),false);
 assert.equal(Object.hasOwn(pkg.scripts,'deploy:precificador'),false);
});
