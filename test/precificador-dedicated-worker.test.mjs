import {test} from 'node:test';
import assert from 'node:assert/strict';
import pricingWorker from '../src/precificador-worker.mjs';

const host='https://precificador-artisys-central.nutricionistaalmeidavh.workers.dev';
const context={waitUntil(){}};
test('Worker separado entrega a calculadora sem banco de dados nem token de pagamento',async()=>{
 const files=[];
 const env={PRECIFICADOR_ASSETS:{fetch:async req=>{files.push(new URL(req.url).pathname);return new Response('page',{status:200})}}};
 for(const path of ['/','/assets/precificador.css','/assets/precificador.js','/assets/precificador-engine.js']){
  const response=await pricingWorker.fetch(new Request(host+path),env,context);
  assert.equal(response.status,200,path);
 }
 assert.deepEqual(files,['/precificador.html','/precificador.css','/precificador.js','/precificador-engine.js']);
});
test('o Worker do precificador não pode servir checkout, admin, orders nem arquivos fora da lista',async()=>{
 const env={PRECIFICADOR_ASSETS:{fetch:async()=>new Response('should not serve')}};
 for(const path of ['/admin','/checkout.html','/comprar','/pedido','/assets/admin.js','/v1/orders','/v1/admin/orders']){
  const response=await pricingWorker.fetch(new Request(host+path),env,context);
  assert.equal(response.status,404,path);
 }
});
test('autenticação é delegada ao Worker principal e não retorna dados financeiros',async()=>{
 const intercepted=[];
 const env={PAGAMENTOS_CENTRAL:{fetch:async req=>{
  intercepted.push({url:req.url,auth:req.headers.get('authorization'),method:req.method});
  return req.headers.get('authorization')==='Bearer valido'?new Response(JSON.stringify({summary:{receivedCents:8500000}}),{status:200}):new Response('denied',{status:401});
 }}};
 const unauthorized=await pricingWorker.fetch(new Request(host+'/v1/admin/summary'),env,context);
 assert.equal(unauthorized.status,401);
 const authorized=await pricingWorker.fetch(new Request(host+'/v1/admin/summary',{headers:{authorization:'Bearer valido'}}),env,context);
 assert.equal(authorized.status,200);
 assert.deepEqual(await authorized.json(),{ok:true});
 assert.equal(intercepted.length,1);
 assert.equal(intercepted[0].url,'https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/v1/admin/summary');
 assert.equal(intercepted[0].auth,'Bearer valido');
});
test('sem binding de serviço o login falha fechado',async()=>{
 const response=await pricingWorker.fetch(new Request(host+'/v1/admin/summary',{headers:{authorization:'Bearer teste'}}),{},context);
 assert.equal(response.status,503);
});
