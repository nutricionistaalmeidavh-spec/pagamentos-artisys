import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindingForOffer,checkoutBinding} from '../src/hub-buyer-binding.mjs';
const sample='eyJ2IjoxLCJ1IjoiZjZmZjZiZTUtYzAxNC00NmJhLWI5M2ItMWE5MTNkYTExZGIzIiwicCI6Imh1YmVzdHVkb3MtY291cnNlLXdlYi1hcGlzIiwicyI6Im9uZV90aW1lIiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.'+'a'.repeat(64);
test('apenas ofertas Hub exigem vínculo assinado; kits e sistemas ignoram campo',()=>{
 assert.equal(bindingForOffer('hubestudos-course-web-apis','webhook',sample),sample);
 assert.equal(bindingForOffer('hubestudos-subscription','webhook',sample),sample);
 assert.throws(()=>bindingForOffer('hubestudos-course-web-apis','webhook',''),/buyer_binding_required/);
 assert.throws(()=>bindingForOffer('hubestudos-course-web-apis','manual',''),/buyer_binding_required/);
 assert.equal(bindingForOffer('pdv-artisys','download',''),null);
 assert.equal(bindingForOffer('devkit-react','download',sample),null);
});
test('formato inválido falha fechado, payload público não inclui binding',()=>{
 assert.throws(()=>bindingForOffer('hubestudos-course-web-apis','webhook','opaque'),/buyer_binding_invalid/);
 assert.throws(()=>bindingForOffer('hubestudos-course-web-apis','webhook',sample+'bad'),/buyer_binding_invalid/);
 assert.equal(checkoutBinding('pdv-artisys',sample),undefined);
 assert.deepEqual(checkoutBinding('hubestudos-course-web-apis',sample),{buyerBinding:sample});
});
