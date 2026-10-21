import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/cloudflare-worker.mjs';

const assets=()=>({PAGAMENTO_ARTISYS_ASSETS:{fetch:async req=>new Response(new URL(req.url).pathname)}});
test('precificador tem rota isolada e não depende de D1 para carregar a interface',async()=>{
 const res=await worker.fetch(new Request('https://pagamentos.artisys.dev/precificar'),assets(),{waitUntil(){}});
 assert.equal(res.status,200);
 assert.equal(await res.text(),'/precificador.html');
});
test('raiz tradicional da central continua checkout',async()=>{
 const res=await worker.fetch(new Request('https://pagamentos.artisys.dev/'),assets(),{waitUntil(){}});
 assert.equal(await res.text(),'/checkout.html');
});
test('recursos da ferramenta têm mapeamento explícito',async()=>{
 for(const name of ['precificador.css','precificador.js','precificador-engine.js']){
  const res=await worker.fetch(new Request('https://pagamentos.artisys.dev/assets/'+name),assets(),{waitUntil(){}});
  assert.equal(res.status,200);
  assert.equal(await res.text(),'/'+name);
 }
});
