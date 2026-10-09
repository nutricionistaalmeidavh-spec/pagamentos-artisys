import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseAsaas} from '../src/asaas-diagnostic.mjs';
import worker from '../src/cloudflare-worker.mjs';

const BASE='https://pagamentos-artisys-central.example.workers.dev';
const env=(extra={})=>({
 ASAAS_API_KEY:'qa-api-token-never-expose',
 ASAAS_API_BASE_URL:'https://api.asaas.com/v3',
 ASAAS_WEBHOOK_TOKEN:'qa-webhook-token-32-characters-long-at-least',
 PUBLIC_BASE_URL:BASE,
 ...extra
});
const destination=BASE+'/v1/webhooks/asaas';
const events=['CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED'];
const goodWebhook=()=>({id:'wh_id_dont_return',url:destination,name:'Pagamento ArtiSys Central',enabled:true,interrupted:false,events,authToken:'must-not-appear',email:'private@example.com'});
const createFetch=(hooks=[goodWebhook()],status=200)=>{
 const calls=[];
 const fetchImpl=async(uri,init={})=>{
  calls.push({url:String(uri),method:init.method||'GET',header:init.headers?.access_token});
  if(status!==200)return Response.json({errors:[{description:'secret provider response'}]},{status});
  if(String(uri).endsWith('/wallets/'))return Response.json({walletId:'wallet-sensitive'});
  if(String(uri).includes('/webhooks?'))return Response.json({data:hooks,hasMore:false});
  throw Error('Unrecognized endpoint');
 };
 return {calls,fetchImpl};
};
test('diagnóstico faz apenas leituras, confirma Asaas e URL/eventos, mas NÃO certifica token do webhook',async()=>{
 const {calls,fetchImpl}=createFetch();
 const out=await diagnoseAsaas(env(),fetchImpl);
 assert.equal(out.apiAuthenticated,true);
 assert.equal(out.environment,'production');
 assert.equal(out.webhook.found,true);
 assert.equal(out.webhook.enabled,true);
 assert.equal(out.webhook.interrupted,false);
 assert.equal(out.webhook.eventsConfigured,true);
 assert.equal(out.webhook.urlMatches,true);
 assert.equal(out.webhookTokenConfigured,true);
 assert.equal(out.webhookTokenVerified,false);
 assert.equal(out.configurationReady,true);
 assert.deepEqual(calls.map(x=>x.method),['GET','GET']);
 assert.ok(calls.every(x=>x.header==='qa-api-token-never-expose'));
 assert.doesNotMatch(JSON.stringify(out),/wallet-sensitive|must-not-appear|private@example\.com|qa-api-token|wh_id_dont_return/);
});
test('falta de eventos impede aprovação operacional',async()=>{
 const {fetchImpl}=createFetch([{...goodWebhook(),events:['CHECKOUT_CREATED','CHECKOUT_PAID']}]);
 const out=await diagnoseAsaas(env(),fetchImpl);
 assert.deepEqual(out.webhook.missingEvents,['CHECKOUT_CANCELED','CHECKOUT_EXPIRED']);
 assert.equal(out.configurationReady,false);
});
test('webhook desativado, fila interrompida ou URL errada bloqueiam readiness',async()=>{
 for(const hook of [{...goodWebhook(),enabled:false},{...goodWebhook(),interrupted:true},{...goodWebhook(),url:'https://wrong.example/webhook'}]){
  const {fetchImpl}=createFetch([hook]);
  const out=await diagnoseAsaas(env(),fetchImpl);
  assert.equal(out.configurationReady,false);
 }
});
test('key inválida e falha HTTP não vazam mensagens sensíveis nem segredos',async()=>{
 const {fetchImpl}=createFetch([],401);
 const out=await diagnoseAsaas(env(),fetchImpl);
 assert.equal(out.apiAuthenticated,false);
 assert.equal(out.apiStatus,'unauthorized');
 assert.equal(out.configurationReady,false);
 assert.doesNotMatch(JSON.stringify(out),/secret provider response|qa-api-token/);
});
test('permissão insuficiente para listar webhooks não aprova configuração',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push([url,opts?.method||'GET']);
  if(url.endsWith('/wallets/'))return Response.json({walletId:'x'});
  return Response.json({errors:[{description:'forbidden'}]},{status:403});
 };
 const out=await diagnoseAsaas(env(),fetchImpl);
 assert.equal(out.apiAuthenticated,true);
 assert.equal(out.webhook.status,'forbidden');
 assert.equal(out.configurationReady,false);
});
test('sandbox por default e webhook sem token local não são certificados para produção',async()=>{
 for(const e of [env({ASAAS_API_BASE_URL:undefined}),env({ASAAS_WEBHOOK_TOKEN:''})]){
  const {fetchImpl}=createFetch();
  const out=await diagnoseAsaas(e,fetchImpl);
  assert.equal(out.configurationReady,false);
 }
});
test('endpoint é privado e não invoca API Asaas sem ADMIN_TOKEN',async()=>{
 const d1={
  prepare(){return{bind(){return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})};},
  batch:async()=>[]
 };
 const runtime={...env(),ADMIN_TOKEN:'admin-0123456789-test-token-32-chars',PAGAMENTO_ARTISYS_DB:d1};
 let providerCalls=0,original=globalThis.fetch;
 globalThis.fetch=async()=>{providerCalls++;return Response.json({});};
 try{
  const r=await worker.fetch(new Request(BASE+'/v1/admin/asaas/diagnostic',{headers:{authorization:'Bearer wrong'}}),runtime,{waitUntil(){}});
  assert.equal(r.status,401);
  assert.equal(providerCalls,0);
 }finally{globalThis.fetch=original;}
});
test('endpoint autorizado devolve apenas diagnóstico e não toca em cobranças',async()=>{
 const d1={
  prepare(){return{bind(){return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})};},
  batch:async()=>[]
 };
 const runtime={...env(),ADMIN_TOKEN:'admin-0123456789-test-token-32-chars',PAGAMENTO_ARTISYS_DB:d1};
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url:String(url),method:opts.method||'GET'});
  return String(url).endsWith('/wallets/')?Response.json({walletId:'secret-wallet'}):Response.json({data:[goodWebhook()],hasMore:false});
 };
 try{
  const r=await worker.fetch(new Request(BASE+'/v1/admin/asaas/diagnostic',{headers:{authorization:'Bearer '+runtime.ADMIN_TOKEN}}),runtime,{waitUntil(){}});
  assert.equal(r.status,200);
  const out=await r.json();
  assert.equal(out.apiAuthenticated,true);
  assert.equal(out.configurationReady,true);
  assert.deepEqual(calls.map(c=>c.method),['GET','GET']);
  assert.doesNotMatch(JSON.stringify(out),/secret-wallet|qa-api-token|must-not-appear/);
 }finally{globalThis.fetch=original;}
});
