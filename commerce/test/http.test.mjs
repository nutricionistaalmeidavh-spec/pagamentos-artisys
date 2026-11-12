import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,createHmac} from 'node:crypto';
import {createCore} from '../src/core.mjs';
import {createHandler} from '../src/server.mjs';

async function setup(){
  const core=createCore({
    dbPath:':memory:',masterKey:randomBytes(32).toString('base64'),
    catalog:{'ARTISYS-PDV-NEXUS':{maxDevices:1,productKey:'pdvnexus'}}
  });
  const config={shopifyStoreDomain:'85pits-mq.myshopify.com',shopifyClientSecret:'test-shop-secret',
    adminToken:'a'.repeat(48),publicBaseUrl:'http://127.0.0.1:8789',mercadoLivreBridgeSecret:'test-ml-secret',
    paymentsBridgeSecret:'payments-secret-32-characters-minimum',paymentsProductSkus:{'pdvnexus':'ARTISYS-PDV-NEXUS'}};
  const server=http.createServer(createHandler(core,config));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const close=async()=>{await new Promise(resolve=>server.close(resolve));core.close()};
  return {core,url,config,close};
}
const order=(financial_status='paid')=>({
  id:874211,email:'test@example.com',currency:'BRL',financial_status,
  line_items:[{id:1,sku:'ARTISYS-PDV-NEXUS',quantity:1}]
});
function headers(raw,secret,topic='orders/paid',shop='85pits-mq.myshopify.com',id='webhook-1'){
  return {'content-type':'application/json','x-shopify-hmac-sha256':createHmac('sha256',secret).update(raw).digest('base64'),
    'x-shopify-shop-domain':shop,'x-shopify-topic':topic,'x-shopify-webhook-id':id};
}
test('P3: Shopify rejects forged webhooks and different store',async()=>{
  const {core,url,close}=await setup();
  try{
    const raw=JSON.stringify(order());
    const invalid=await fetch(url+'/v1/webhooks/shopify',{method:'POST',headers:headers(raw,'wrong'),body:raw});
    assert.equal(invalid.status,401);
    const wrongShop=await fetch(url+'/v1/webhooks/shopify',{method:'POST',
      headers:headers(raw,'test-shop-secret','orders/paid','attacker.myshopify.com'),body:raw});
    assert.equal(wrongShop.status,403);
    assert.equal(core.listLicenses('test@example.com').length,0);
  }finally{await close()}
});
test('P3: paid is idempotent, pending unpaid does not grant',async()=>{
  const {core,url,close}=await setup();
  try{
    const pending=JSON.stringify(order('pending'));
    let response=await fetch(url+'/v1/webhooks/shopify',{method:'POST',
      headers:headers(pending,'test-shop-secret','orders/paid','85pits-mq.myshopify.com','evt-pending'),body:pending});
    assert.equal((await response.json()).created,0);
    const paid=JSON.stringify(order());
    response=await fetch(url+'/v1/webhooks/shopify',{method:'POST',
      headers:headers(paid,'test-shop-secret'),body:paid});
    assert.equal((await response.json()).created,1);
    response=await fetch(url+'/v1/webhooks/shopify',{method:'POST',
      headers:headers(paid,'test-shop-secret'),body:paid});
    assert.equal((await response.json()).duplicate,true);
    assert.equal(core.listLicenses('test@example.com').length,1);
  }finally{await close()}
});
test('P4: admin-generated magic link creates HttpOnly session; buyer sees own licences',async()=>{
  const {core,url,config,close}=await setup();
  try{
    core.receive({source:'shopify',seller:config.shopifyStoreDomain,eventId:'a',externalOrderId:'p1',
      event:'paid',paymentConfirmed:true,email:'test@example.com',lines:[{sku:'ARTISYS-PDV-NEXUS',quantity:1}]});
    const unauthorized=await fetch(url+'/v1/portal/licenses');
    assert.equal(unauthorized.status,401);
    const linkResponse=await fetch(url+'/v1/admin/portal-link',{method:'POST',
      headers:{'authorization':'Bearer '+config.adminToken,'content-type':'application/json'},
      body:JSON.stringify({email:'test@example.com'})});
    assert.equal(linkResponse.status,200);
    const {link}=await linkResponse.json();
    const token=new URL(link).searchParams.get('token');
    const claim=await fetch(url+'/portal/claim?token='+encodeURIComponent(token),{redirect:'manual'});
    assert.equal(claim.status,303);
    const session=claim.headers.get('set-cookie');
    assert.match(session,/HttpOnly/);
    const me=await fetch(url+'/v1/portal/licenses',{headers:{cookie:session.split(';')[0]}});
    assert.equal(me.status,200);
    const buyerLicenses=(await me.json()).licenses;
    assert.equal(buyerLicenses.length,1);
    // Não retornar chave provisória pelo JSON enquanto licença nativa não foi liberada.
    assert.equal(buyerLicenses[0].code,null);
    assert.equal(buyerLicenses[0].activationCode,null);
    const replay=await fetch(url+'/portal/claim?token='+encodeURIComponent(token),{redirect:'manual'});
    assert.equal(replay.headers.get('location'),'/portal?invalid=1');
  }finally{await close()}
});
test('P5: market bridge requires timestamped HMAC and no unknown SKU is granted',async()=>{
  const {core,url,close}=await setup();
  try{
    const data={source:'mercadolivre',seller:'seller-1',eventId:'ml-1',externalOrderId:'ml-order-1',
      event:'paid',paymentConfirmed:true,email:'ml@example.com',lines:[{sku:'ARTISYS-PDV-NEXUS',quantity:1}]};
    const raw=JSON.stringify(data),timestamp=String(Date.now());
    const sig='sha256='+createHmac('sha256','test-ml-secret').update(timestamp+'.'+raw).digest('hex');
    let response=await fetch(url+'/v1/ingest/mercadolivre',{method:'POST',headers:{
      'x-artisys-timestamp':timestamp,'x-artisys-signature':'sha256=bad','content-type':'application/json'},body:raw});
    assert.equal(response.status,401);
    response=await fetch(url+'/v1/ingest/mercadolivre',{method:'POST',headers:{
      'x-artisys-timestamp':timestamp,'x-artisys-signature':sig,'content-type':'application/json'},body:raw});
    assert.equal(response.status,200);
    assert.equal((await response.json()).created,1);
    assert.equal(core.listLicenses('ml@example.com').length,1);
    assert.ok(core.listJobs().some(x=>x.kind==='crm.sale'));
  }finally{await close()}
});

test('P5: current Pagamentos ArtiSys fulfillment contract never ACKs before native activation',async()=>{
  const {core,url,config,close}=await setup();
  try{
    const data={event:'artisys.license.activate',orderId:'pending-payment-1',productId:'pdvnexus',
      email:'payer@example.com',customerName:'Cliente',idempotencyKey:'fulfillment-1',currency:'BRL'};
    const raw=JSON.stringify(data),ts=String(Date.now()),signature='sha256='+
      createHmac('sha256',config.paymentsBridgeSecret).update(ts+'.'+raw).digest('hex');
    const response=await fetch(url+'/v1/ingest/artisys-payments/connector',{method:'POST',
      headers:{'content-type':'application/json','x-artisys-timestamp':ts,'x-artisys-signature':signature},body:raw});
    assert.equal(response.status,409);
    assert.equal((await response.json()).accepted,false);
    assert.equal(core.listLicenses('payer@example.com').length,1);
    assert.equal(core.listLicenses('payer@example.com')[0].activationStatus,'awaiting_connector');
  }finally{await close()}
});
test('P5: connector ACK requires native product code; verified code is shown to buyer',async()=>{
  const {core,url,config,close}=await setup();
  const native=http.createServer(async(req,res)=>{
    const body=await new Promise(resolve=>{let text='';req.on('data',part=>text+=part);req.on('end',()=>resolve(text))});
    assert.ok(String(body).includes('"event":"product.grant"'));
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({accepted:true,activationCode:'654321'}));
  });
  await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));
  try{
    config.productConnectors={'ARTISYS-PDV-NEXUS':{
      url:'http://127.0.0.1:'+native.address().port+'/license',secret:'product-secret-32-characters-minimum'
    }};
    const data={event:'artisys.license.activate',orderId:'paid-2',productId:'pdvnexus',
      email:'buyer2@example.com',customerName:'Comprador',idempotencyKey:'fulfillment-2',currency:'BRL'};
    const raw=JSON.stringify(data),ts=String(Date.now()),signature='sha256='+
      createHmac('sha256',config.paymentsBridgeSecret).update(ts+'.'+raw).digest('hex');
    const response=await fetch(url+'/v1/ingest/artisys-payments/connector',{method:'POST',
      headers:{'content-type':'application/json','x-artisys-timestamp':ts,'x-artisys-signature':signature},body:raw});
    assert.equal(response.status,200);
    assert.equal((await response.json()).accepted,true);
    assert.equal(core.listLicenses('buyer2@example.com')[0].activationCode,'654321');
    assert.equal(core.listLicenses('buyer2@example.com')[0].activationStatus,'provisioned');
  }finally{await new Promise(resolve=>native.close(resolve));await close()}
});
