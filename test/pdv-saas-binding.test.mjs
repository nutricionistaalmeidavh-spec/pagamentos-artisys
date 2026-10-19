import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindingForOffer,checkoutBinding,needsBuyerBinding} from '../src/hub-buyer-binding.mjs';
const binding='a'.repeat(55)+'.'+'b'.repeat(64);
test('PDV SaaS monthly/yearly checkout requires signed tenant binding and webhook delivery',()=>{
 assert.equal(needsBuyerBinding('pdv-total-saas'),true);
 assert.equal(bindingForOffer('pdv-total-saas','webhook',binding),binding);
 assert.deepEqual(checkoutBinding('pdv-total-saas',binding),{buyerBinding:binding});
 assert.throws(()=>bindingForOffer('pdv-total-saas','webhook',''),/buyer_binding_required/);
 assert.throws(()=>bindingForOffer('pdv-total-saas','manual',binding),/buyer_binding_invalid/);
 assert.throws(()=>bindingForOffer('pdv-total-saas','webhook','not-signed'),/buyer_binding_invalid/);
 assert.equal(bindingForOffer('pdv-artisys','download',''),null);
});
