import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/admin.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin.css',import.meta.url),'utf8');

test('painel opera por Início, Pedidos, Ofertas e Mais, em navegação mobile acessível',()=>{
 for(const name of ['inicio','pedidos','ofertas','mais']){
  assert.match(html,new RegExp('data-screen="'+name+'"'));
  assert.match(html,new RegExp('id="'+name+'"'));
 }
 assert.match(html,/aria-label="Navegação principal"/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/@media\s*\(min-width:\s*800px\)/);
 assert.doesNotMatch(css,/min-width:\s*670px/);
});
test('não usa registros fictícios nem mocks no painel real',()=>{
 assert.doesNotMatch(js,/Cliente Exemplo|DEM-000|RASCUNHO DEMONSTRATIVO|data-simulate/);
 assert.match(js,/\/v1\/admin\//);
 assert.match(js,/\/healthz/);
 assert.match(js,/response\.ok/);
});
test('preparação de oferta inicia em rascunho e publicação pede revisão',()=>{
 assert.match(js,/active:\s*false/);
 assert.match(js,/Revisar e salvar/);
 assert.match(js,/Publicar oferta/);
 assert.match(js,/paymentsEnabled/);
});
test('pagamento e entrega são apresentados em estados distintos',()=>{
 assert.match(js,/paymentLabel/);
 assert.match(js,/deliveryLabel/);
 assert.match(js,/confirm-manual/);
 assert.match(js,/deliver-manual/);
 assert.match(js,/reconcile/);
 assert.match(js,/Reprocessar/);
});
test('ações críticas exigem confirmação e possuem feedback de erro',()=>{
 assert.match(js,/confirmAction/);
 assert.match(js,/aria-modal="true"/);
 assert.match(js,/aria-live/);
 assert.match(js,/disabled=true/);
 assert.match(js,/showError/);
 assert.doesNotMatch(js,/\bwindow\.confirm\s*\(/);
});
test('ofertas incluem preço seguro e cupons preservados no painel',()=>{
 assert.match(js,/priceCents/);
 assert.match(js,/percentOff/);
 assert.match(js,/deliveryMode/);
 assert.match(js,/coupon-form/);
});
