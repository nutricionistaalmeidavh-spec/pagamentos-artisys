import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HUB_COURSE_TEMPLATES,offerCategory,courseTemplatesPending} from '../src/hub-course-catalog.mjs';

test('218 aulas estão agrupadas em cinco trilhas comerciais com IDs canônicos únicos',()=>{
 assert.equal(HUB_COURSE_TEMPLATES.length,5);
 assert.equal(HUB_COURSE_TEMPLATES.reduce((total,x)=>total+x.lessons,0),218);
 assert.equal(new Set(HUB_COURSE_TEMPLATES.map(x=>x.id)).size,5);
 assert.equal(new Set(HUB_COURSE_TEMPLATES.map(x=>x.productId)).size,5);
 for(const t of HUB_COURSE_TEMPLATES){
  assert.match(t.productId,/^hubestudos-course-trilha-[a-z0-9-]+$/);
  assert.equal(t.priceCents,null,'Não gravar preço simulado.');
  assert.equal(t.active,false);
  assert.equal(t.deliveryMode,'webhook');
  assert.equal(t.saleType,'one_time');
  assert.equal(t.category,'cursos');
 }
});
test('categorias preservam quatro sistemas e 63 DevKits legados',()=>{
 assert.equal(offerCategory({id:'obra-na-mao',product_id:'obra-na-mao'}),'sistemas');
 assert.equal(offerCategory({id:'pdv-nexus',product_id:'pdv-nexus'}),'sistemas');
 assert.equal(offerCategory({id:'artisys-qa',product_id:'artisys-qa'}),'devkits');
 assert.equal(offerCategory({id:'artisys-security',product_id:'artisys-security'}),'devkits');
 assert.equal(offerCategory({id:'other',product_id:'hubestudos-subscription'}),'cursos');
 assert.equal(offerCategory({id:'legacy',product_id:'hubestudos-course-web-apis'}),'cursos');
 assert.equal(offerCategory({id:'unmapped',product_id:'custom-id'}),'outros');
});
test('modelos desaparecem individualmente após preço cadastrado, sem sobrescrever uma oferta real',()=>{
 const [first,second]=HUB_COURSE_TEMPLATES;
 const existing=[{id:first.id,product_id:first.productId,price_cents:12900,active:1}];
 const waiting=courseTemplatesPending(existing);
 assert.equal(waiting.length,4);
 assert.ok(waiting.some(x=>x.id===second.id));
 assert.deepEqual(existing,[{id:first.id,product_id:first.productId,price_cents:12900,active:1}]);
 assert.equal(courseTemplatesPending(HUB_COURSE_TEMPLATES).length,0);
});
