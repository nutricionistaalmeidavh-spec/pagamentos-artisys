import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/app.mjs';
import worker from '../src/cloudflare-worker.mjs';
import {pdvBillingStatus,pdvBillingStatusPath} from '../src/pdv-billing-status.mjs';
const secret='existing-private-billing-connector-secret-2026',now=1792800000000;
const env={PRODUCT_CONNECTORS_JSON:JSON.stringify({'pdv-total-saas':{secret}})};
const payload={tenantId:'company',orders:[{orderId:'order-1',userId:'owner'}]};
const binding=Buffer.from(JSON.stringify({v:1,tenantId:'company',userId:'owner',expiresAt:now-1000})).toString('base64url')+'.'+'a'.repeat(64);
function request(data=payload,stamp=now,key=secret){
 const raw=JSON.stringify(data);
 return new Request('https://central.example.test'+pdvBillingStatusPath,{method:'POST',headers:{'content-type':'application/json','x-artisys-timestamp':String(stamp),
  'x-artisys-signature':'sha256='+createHmac('sha256',key).update(stamp+'.'+pdvBillingStatusPath+'.'+raw).digest('hex')},body:raw});
}
test('signed status query is read-only, historical, and tenant/user/product scoped',async()=>{
 const row={product_id:'pdv-total-saas',status:'pending',checkout_state:'ready',fulfillment_status:'not_started',binding,access_hash:'secret',customer_email:'private@example.test'};
 for(const status of ['pending','paid','refunded','expired','canceled']){
  const response=await pdvBillingStatus(request(),env,async()=>({...row,status}),{now});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).orders,[{orderId:'order-1',status,checkoutState:'ready',fulfillmentStatus:'not_started'}]);
 }
 for(const other of [{...row,product_id:'other'}, {...row,binding:'invalid'},null]){
  assert.deepEqual((await (await pdvBillingStatus(request(),env,async()=>other,{now})).json()).orders,[{orderId:'order-1',status:'unavailable'}]);
 }
 for(const data of [{...payload,tenantId:'other'},{...payload,orders:[{orderId:'order-1',userId:'other'}]}]){
  assert.equal((await (await pdvBillingStatus(request(data),env,async()=>row,{now})).json()).orders[0].status,'unavailable');
 }
});
test('invalid, expired, cross-purpose and oversized queries fail before accessing orders',async()=>{
 const never=()=>{throw Error('must not read orders');};
 for(const req of [request(payload,now,'wrong-secret'),request(payload,now-300001)])assert.equal((await pdvBillingStatus(req,env,never,{now})).status,401);
 const cross=request();cross.headers.set('x-artisys-signature','sha256='+createHmac('sha256',secret).update(now+'.'+JSON.stringify(payload)).digest('hex'));
 assert.equal((await pdvBillingStatus(cross,env,never,{now})).status,401);
 assert.equal((await pdvBillingStatus(request({...payload,orders:Array(51).fill(payload.orders[0])}),env,never,{now})).status,400);
 assert.equal((await pdvBillingStatus(request(),{},never,{now})).status,503);
 const huge=request();huge.headers.set('content-length','16001');assert.equal((await pdvBillingStatus(huge,env,never,{now})).status,413);
});
test('self-hosted HTTP route preserves raw signatures and never changes order/payment state',async()=>{
 const app=createApp({dbPath:':memory:',autoprocess:false,env});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{
  const req=request(payload,Date.now());
  const response=await fetch('http://127.0.0.1:'+app.server.address().port+pdvBillingStatusPath,{method:'POST',headers:req.headers,body:await req.text()});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).orders[0].status,'unavailable');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM fulfillments').get().n,0);
 }finally{await new Promise(resolve=>app.server.close(resolve));app.close();}
});

test('Worker route reads an existing pending checkout from D1 and preserves fulfillment state',async()=>{
 const raw=new DatabaseSync(':memory:');
 const statement=(sql,args=[])=>({bind(...values){return statement(sql,values);},
  async first(){return raw.prepare(sql).get(...args)||null;},
  async all(){return {results:raw.prepare(sql).all(...args)};},
  async run(){return {meta:{changes:raw.prepare(sql).run(...args).changes}};}});
 const db={prepare:sql=>statement(sql),batch:queries=>Promise.all(queries.map(q=>q.run()))};
 const options={...env,PAGAMENTO_ARTISYS_DB:db},ctx={waitUntil(){}};
 try{
  assert.equal((await worker.fetch(new Request('https://central.example.test/healthz'),options,ctx)).status,200);
  raw.prepare("INSERT INTO orders(id,offer_id,product_id,customer_email,amount_cents,original_amount_cents,sale_type,delivery_mode,access_hash,idem_key,checkout_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .run('order-1','monthly','pdv-total-saas','owner@example.test',8900,8900,'monthly','webhook','private-hash','unique-idempotency','ready',new Date(now).toISOString(),new Date(now).toISOString());
  raw.prepare('INSERT INTO order_buyer_bindings VALUES(?,?)').run('order-1',binding);
  const response=await worker.fetch(request(payload,Date.now()),options,ctx);
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).orders,[{orderId:'order-1',status:'pending',checkoutState:'ready',fulfillmentStatus:'not_started'}]);
  assert.equal(raw.prepare('SELECT status FROM orders').get().status,'pending');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM fulfillments').get().n,0);
 }finally{raw.close();}
});
