import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createCore, verifyShopifyHmac, verifyBridgeHmac } from '../src/core.mjs';

function fixture() {
  const core=createCore({
    dbPath: ':memory:',
    masterKey: randomBytes(32).toString('base64'),
    catalog: {
      'ARTISYS-PDV-NEXUS': {name:'PDV Nexus', maxDevices:1, downloadUrl:'https://github.com/example/repo/releases/download/v1/app.exe'},
      'ARTISYS-OBRA-DESKTOP': {name:'Obra na Mão', maxDevices:2}
    }
  });
  return core;
}
const paid=(extra={})=>({
  source:'shopify', seller:'85pits-mq.myshopify.com', eventId:'evt-1',
  externalOrderId:'123456', event:'paid', paymentConfirmed:true,
  email:'Comprador@EXAMPLE.COM', name:'Cliente Teste', currency:'BRL',
  lines:[{id:'line-1',sku:'ARTISYS-PDV-NEXUS',quantity:1}], ...extra
});

test('P2: no licence for unpaid order and 16-character key only after confirmed payment',()=>{
  const core=fixture();
  assert.equal(core.receive({...paid(),eventId:'waiting',event:'pending',paymentConfirmed:false}).created,0);
  assert.equal(core.listLicenses('comprador@example.com').length,0);
  const result=core.receive(paid());
  assert.equal(result.created,1);
  const [license]=core.listLicenses('comprador@example.com');
  assert.match(license.code,/^[A-Z2-9]{16}$/);
  assert.equal(license.activationStatus,'awaiting_connector');
  assert.equal(license.status,'active');
  assert.equal(core.db.prepare('SELECT COUNT(*) n FROM entitlements').get().n,1);
  assert.equal(core.db.prepare('SELECT code_secret FROM entitlements').get().code_secret.includes(license.code),false);
  core.close();
});

test('P2: duplicate webhook and separate retries do not issue additional licences',()=>{
  const core=fixture();
  assert.equal(core.receive(paid()).created,1);
  assert.equal(core.receive(paid()).duplicate,true);
  assert.equal(core.receive({...paid(),eventId:'evt-2'}).created,0);
  assert.equal(core.db.prepare('SELECT COUNT(*) n FROM entitlements').get().n,1);
  core.close();
});

test('P2: cancelled order cannot be revived by delayed paid webhook',()=>{
  const core=fixture();
  core.receive(paid());
  core.receive({...paid(),eventId:'evt-cancel',event:'cancelled'});
  assert.equal(core.listLicenses('comprador@example.com')[0].status,'revoked');
  core.receive({...paid(),eventId:'evt-delayed'});
  assert.equal(core.listLicenses('comprador@example.com')[0].status,'revoked');
  core.close();
});

test('P2: unknown SKU or invalid email never creates entitlements',()=>{
  const core=fixture();
  assert.equal(core.receive({...paid(),lines:[{id:'a',sku:'UNKNOWN',quantity:1}]}).created,0);
  assert.equal(core.receive({...paid(),eventId:'evt-2',email:'',externalOrderId:'2'}).created,0);
  core.close();
});

test('P4: portal one-time token can be exchanged once and session is scoped to email',()=>{
  const core=fixture();
  core.receive(paid());
  const link=core.createPortalLink('COMPRADOR@example.com','https://license.example.test');
  assert.ok(link.includes('/portal/claim?token='));
  const token=new URL(link).searchParams.get('token');
  const session=core.consumePortalToken(token);
  assert.ok(session);
  assert.equal(core.consumePortalToken(token),null);
  assert.equal(core.sessionEmail(session),'comprador@example.com');
  assert.equal(core.listLicenses(core.sessionEmail(session)).length,1);
  assert.equal(core.listLicenses('outro@example.com').length,0);
  core.close();
});

test('P3: Shopify raw body HMAC and bridge timestamp HMAC reject tampering',()=>{
  const raw=Buffer.from(JSON.stringify({id:123,financial_status:'paid'}));
  const key='shopify-secret';
  const {createHmac}=requireCrypto();
  const signed=createHmac('sha256',key).update(raw).digest('base64');
  assert.equal(verifyShopifyHmac(raw,signed,key),true);
  assert.equal(verifyShopifyHmac(Buffer.from('{}'),signed,key),false);
  const ts=String(Date.now());
  const sig='sha256='+createHmac('sha256',key).update(ts+'.'+raw).digest('hex');
  assert.equal(verifyBridgeHmac(raw,ts,sig,key),true);
  assert.equal(verifyBridgeHmac(raw,String(Date.now()-600000),sig,key),false);
});
function requireCrypto(){return {createHmac:(...args)=>importedCreateHmac(...args)}}
import {createHmac as importedCreateHmac} from 'node:crypto';

test('P5: CRM and native fulfilment outbox are distinct; no automatic external action without configuration',()=>{
  const core=fixture();
  core.receive(paid());
  const jobs=core.listJobs();
  assert.ok(jobs.some(j=>j.kind==='product.grant' && j.status==='pending'));
  assert.ok(jobs.some(j=>j.kind==='crm.sale' && j.status==='pending'));
  assert.equal(jobs.some(j=>j.status==='sent'),false);
  core.close();
});

test('P2: repeated line items of same SKU issue one entitlement per purchased seat',()=>{
  const core=fixture();
  try{
    const receipt=paid({lines:[
      {id:'line-A',sku:'ARTISYS-PDV-NEXUS',quantity:1},
      {id:'line-B',sku:'ARTISYS-PDV-NEXUS',quantity:2}
    ]});
    const result=core.receive(receipt);
    assert.equal(result.created,3);
    assert.equal(core.listLicenses('comprador@example.com').length,3);
    const keys=core.listLicenses('comprador@example.com').map(x=>x.code);
    assert.equal(new Set(keys).size,3);
  }finally{core.close()}
});

test('P2: cancelled sale supersedes queued activation to prevent late license grants',()=>{
  const core=fixture();
  try{
    core.receive(paid({eventId:'paid-then-cancelled'}));
    assert.ok(core.pendingJobs().some(j=>j.kind==='product.grant'));
    core.receive({...paid(),eventId:'cancel-after-paid',event:'cancelled'});
    assert.equal(core.pendingJobs().filter(j=>j.kind==='product.grant').length,0);
    assert.equal(core.listLicenses('comprador@example.com')[0].status,'revoked');
    assert.ok(core.pendingJobs().some(j=>j.kind==='product.revoke'));
  }finally{core.close()}
});
