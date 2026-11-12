import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
import {createCore} from '../src/core.mjs';
import {handlePdvNativeDelivery} from '../src/native-pdv.mjs';

const base='https://pdv-native.example.test';
const secret='hmac-for-licensed-PDV-Oficina-connection';
function fixture(){
 const core=createCore({dbPath:':memory:',masterKey:randomBytes(32).toString('base64'),
 catalog:{'ARTISYS-PDV-DESKTOP':{maxDevices:1},'ARTISYS-OFICINA-DESKTOP':{maxDevices:1}}});
 return core;
}
function delivery(kind='product.grant',sku='ARTISYS-PDV-DESKTOP',id='11111111-1111-4111-8111-111111111111'){
 const event={event:kind,deliveryId:'22222222-2222-4222-8222-222222222222',
 payload:{licenseId:id,sku,email:'buyer@example.com',orderId:'9999',maxDevices:1,productKey:sku}};
 const raw=Buffer.from(JSON.stringify(event)),ts=String(Date.now());
 return {raw,ts,hmac:'sha256='+createHmac('sha256',secret).update(ts+'.').update(raw).digest('hex')};
}
function fakeNative({existing=[],failCreate=false}={}){
 const calls=[];
 const fetchImpl=async(input,opts={})=>{
  const url=new URL(input);calls.push({url:url.pathname,method:opts.method||'GET'});
  if(url.pathname==='/v1/admin/session')
   return new Response(null,{status:204,headers:{'set-cookie':'__Host-artisys_admin_session=fake-session; Secure; HttpOnly; Path=/'}});
  if(url.pathname==='/v1/admin/licenses'&&opts.method!=='POST')
   return Response.json({licenses:existing});
  if(url.pathname==='/v1/admin/licenses'&&opts.method==='POST')
   return failCreate?Response.json({error:'blocked'},{status:409}):Response.json({licenseId:'native-1',code:'645123',codeExpiresAt:'2026-12-01T00:00:00Z'},{status:201});
  if(url.pathname==='/v1/admin/licenses/native-1'&&opts.method==='PATCH')
   return Response.json({updated:true,id:'native-1',status:'CANCELLED'});
  return Response.json({error:'unmatched'}, {status:404});
 };
 return {fetchImpl,calls};
}
const conf={pdvNativeBaseUrl:base,pdvNativeAdminToken:'s'.repeat(48),pdvBridgeSecret:secret};
test('PDV native: rejects forged signed deliveries without mutation',async()=>{
 const core=fixture();const fake=fakeNative();
 try{
  const d=delivery();const r=await handlePdvNativeDelivery({core,config:conf,raw:d.raw,timestamp:d.ts,signature:'sha256=bad',fetchImpl:fake.fetchImpl});
  assert.equal(r.status,401);assert.equal(fake.calls.length,0);
 }finally{core.close()}
});
test('PDV native: provisions product code and replays exact code without recreating native license',async()=>{
 const core=fixture(),fake=fakeNative();
 try{
  const d=delivery();
  const first=await handlePdvNativeDelivery({core,config:conf,raw:d.raw,timestamp:d.ts,signature:d.hmac,fetchImpl:fake.fetchImpl});
  assert.equal(first.status,200);assert.deepEqual({accepted:first.body.accepted,activationCode:first.body.activationCode},{accepted:true,activationCode:'645123'});
  assert.equal(fake.calls.filter(c=>c.url==='/v1/admin/licenses'&&c.method==='POST').length,1);
  const replay=await handlePdvNativeDelivery({core,config:conf,raw:d.raw,timestamp:d.ts,signature:d.hmac,fetchImpl:fake.fetchImpl});
  assert.equal(replay.body.activationCode,'645123');
  assert.equal(fake.calls.filter(c=>c.url==='/v1/admin/licenses'&&c.method==='POST').length,1);
  assert.notEqual(core.db.prepare('SELECT code_secret FROM native_pdv_links').get().code_secret,'645123');
 }finally{core.close()}
});
test('PDV native: never overwrites license belonging to a prior unrelated purchase',async()=>{
 const core=fixture(),fake=fakeNative({existing:[{id:'old-1',email:'buyer@example.com',product:'PDV',status:'ACTIVE'}]});
 try{
  const d=delivery();
  const r=await handlePdvNativeDelivery({core,config:conf,raw:d.raw,timestamp:d.ts,signature:d.hmac,fetchImpl:fake.fetchImpl});
  assert.equal(r.status,409);
  assert.equal(fake.calls.filter(c=>c.method==='POST'&&c.url==='/v1/admin/licenses').length,0);
 }finally{core.close()}
});
test('Oficina native: product scope is OFICINA and cancellation only revokes exact owned license',async()=>{
 const core=fixture(),fake=fakeNative();
 try{
  const g=delivery('product.grant','ARTISYS-OFICINA-DESKTOP');
  assert.equal((await handlePdvNativeDelivery({core,config:conf,raw:g.raw,timestamp:g.ts,signature:g.hmac,fetchImpl:fake.fetchImpl})).status,200);
  const r=delivery('product.revoke','ARTISYS-OFICINA-DESKTOP');
  assert.equal((await handlePdvNativeDelivery({core,config:conf,raw:r.raw,timestamp:r.ts,signature:r.hmac,fetchImpl:fake.fetchImpl})).status,200);
  assert.equal(fake.calls.filter(c=>c.url==='/v1/admin/licenses/native-1'&&c.method==='PATCH').length,1);
  const noLink=delivery('product.revoke','ARTISYS-PDV-DESKTOP','33333333-3333-4333-8333-333333333333');
  assert.equal((await handlePdvNativeDelivery({core,config:conf,raw:noLink.raw,timestamp:noLink.ts,signature:noLink.hmac,fetchImpl:fake.fetchImpl})).status,200);
  assert.equal(fake.calls.filter(c=>c.method==='PATCH').length,1);
 }finally{core.close()}
});
