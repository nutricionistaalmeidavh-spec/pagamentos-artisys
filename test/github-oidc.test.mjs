import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import {verifyReleaseGithubOidc} from '../src/github-oidc.mjs';
import worker from '../src/cloudflare-worker.mjs';
const now=Math.floor(Date.now()/1000);
const repo='nutricionistaalmeidavh-spec/pagamentos-artisys';
const workflow=repo+'/.github/workflows/sync-system-releases-r2.yml@refs/heads/main';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),use:'sig',alg:'RS256',kid:'test-key-1'};
function b64(x){return Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')}
const claim=()=>({iss:'https://token.actions.githubusercontent.com',aud:'artisys-release-sync-r2',repository:repo,
 sub:'repo:'+repo+':ref:refs/heads/main',ref:'refs/heads/main',workflow_ref:workflow,
 event_name:'push',iat:now-2,nbf:now-2,exp:now+250});
function jwt(payload=claim()){const h=b64({alg:'RS256',typ:'JWT',kid:'test-key-1'}),p=b64(payload);const sig=createSign('RSA-SHA256').update(h+'.'+p).sign(privateKey).toString('base64url');return h+'.'+p+'.'+sig}
const keys=async()=>Response.json({keys:[jwk]});
const req=(token)=>new Request('https://example.test/v1/admin/system-releases',{headers:{authorization:'Bearer '+token}});
test('valida OIDC assinado do GitHub, main e workflow exato',async()=>{
 assert.equal(await verifyReleaseGithubOidc(req(jwt()),keys,now),true);
});
test('rejeita assinatura adulterada e JWT sem cabeçalho RS256',async()=>{
 const good=jwt(),pieces=good.split('.');
 const tampered=pieces[0]+'.'+b64({...claim(),repository:'nutricionistaalmeidavh-spec/other'})+'.'+pieces[2];
 assert.equal(await verifyReleaseGithubOidc(req(tampered),keys,now),false);
 assert.equal(await verifyReleaseGithubOidc(req('invalid.jwt.x'),keys,now),false);
});
test('OIDC rejeita audience, branch, fluxo, horário e repositório incorretos',async()=>{
 const bad=[
  {aud:'another'}, {ref:'refs/heads/feature'}, {workflow_ref:repo+'/.github/workflows/ci.yml@refs/heads/main'},
  {event_name:'pull_request'}, {repository:'somebody/else'}, {exp:now-100},
  {nbf:now+100}, {iat:now+100}, {sub:'repo:'+repo+':environment:prod'}
 ];
 for(const change of bad)assert.equal(await verifyReleaseGithubOidc(req(jwt({...claim(),...change})),keys,now),false,JSON.stringify(change));
});
test('JWKS errado e sem permissão não habilitam token',async()=>{
 assert.equal(await verifyReleaseGithubOidc(req(jwt()),async()=>Response.json({keys:[]}),now),false);
 assert.equal(await verifyReleaseGithubOidc(new Request('https://example.test'),keys,now),false);
});
test('JWT do Actions só autoriza gerenciador de releases, nunca admin financeiro',async()=>{
 const d1={batch:async()=>[],prepare(){return{bind(){return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})}}};
 const env={ADMIN_TOKEN:'this-is-unique-admin-token-for-test',PAGAMENTO_ARTISYS_DB:d1,PAGAMENTO_ARTISYS_ARQUIVOS:{head:async()=>null}};
 const old=globalThis.fetch;globalThis.fetch=keys;
 try{
  const jwtToken=jwt();
  const r=await worker.fetch(req(jwtToken),env,{waitUntil(){}});
  assert.equal(r.status,200);
  const result=await r.json();assert.equal(result.total,8);
  const denied=await worker.fetch(new Request('https://example.test/v1/admin/summary',{headers:{authorization:'Bearer '+jwtToken}}),env,{waitUntil(){}});
  assert.equal(denied.status,401);
 }finally{globalThis.fetch=old;}
});
test('OIDC upload exige hash canônico, não apenas tamanho',async()=>{
 const d1={batch:async()=>[],prepare(){return{bind(){return this;},first:async()=>null,all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})}}};
 const bucket={head:async()=>null,createMultipartUpload:async()=>({uploadId:'test-session-12345'})};
 const env={ADMIN_TOKEN:'this-is-unique-admin-token-for-test',PAGAMENTO_ARTISYS_DB:d1,PAGAMENTO_ARTISYS_ARQUIVOS:bucket};
 const old=globalThis.fetch;globalThis.fetch=keys;
 try{
  const r=await worker.fetch(new Request('https://example.test/v1/admin/system-releases/pdv-nexus-win10/start',
   {method:'POST',headers:{authorization:'Bearer '+jwt(),'content-type':'application/json'},
    body:JSON.stringify({expectedSize:94404666,sha256:'0'.repeat(64)})}),env,{waitUntil(){}});
  assert.equal(r.status,409);
  assert.equal((await r.json()).error,'file_hash_mismatch');
 }finally{globalThis.fetch=old;}
});
