import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote, cleanQuote, quoteDefaults, proposalText} from '../public/precificador-engine.js';

test('orçamento: custos, contingência e margem sobre a receita sem confundir com markup',()=>{
 const q=calculateQuote({activities:[{name:'Implantação',hours:20}],hourlyCost:50,extraCosts:100,riskPct:10,taxesPct:5,marginPct:35,discountPct:0,roundTo:50});
 assert.equal(q.hours,20);
 assert.equal(q.directCost,1100);
 assert.equal(q.reserve,110);
 assert.equal(q.costBasis,1210);
 assert.equal(q.breakEven,1273.69);
 assert.equal(q.targetPrice,2016.67);
 assert.equal(q.suggestedPrice,2050);
 assert.equal(q.finalPrice,2050);
 assert.ok(q.effectiveMargin>=35);
 assert.equal(q.belowBreakEven,false);
});
test('desconto diminui a margem efetiva e avisa quando abaixo do custo',()=>{
 const q=calculateQuote({activities:[{name:'BI',hours:10}],hourlyCost:100,extraCosts:0,riskPct:0,taxesPct:10,marginPct:30,discountPct:60,roundTo:50});
 assert.equal(q.suggestedPrice,1700);
 assert.equal(q.finalPrice,680);
 assert.equal(q.belowBreakEven,true);
 assert.ok(q.effectiveMargin<0);
});
test('não cobra nada sem esforço e sem custo, mas sinaliza dados insuficientes',()=>{
 const q=calculateQuote({activities:[],hourlyCost:50,extraCosts:0,riskPct:15,taxesPct:5,marginPct:30});
 assert.equal(q.suggestedPrice,0);
 assert.equal(q.hours,0);
 assert.equal(q.hasBasis,false);
});
test('validação bloqueia campos negativos e margens inviáveis',()=>{
 assert.throws(()=>calculateQuote({activities:[{name:'x',hours:-1}]}),/hours/);
 assert.throws(()=>calculateQuote({activities:[],taxesPct:65,marginPct:40}),/margin_sum/);
 assert.throws(()=>calculateQuote({activities:[],discountPct:101}),/discountPct/);
});
test('payback usa ganho mensal do cliente, não confunde margem com ROI',()=>{
 const q=calculateQuote({activities:[{name:'BI',hours:10}],hourlyCost:50,extraCosts:0,riskPct:0,taxesPct:0,marginPct:50,roundTo:50,hoursSavedPerMonth:5,clientHourValue:100});
 assert.equal(q.finalPrice,1000);
 assert.equal(q.monthlyValue,500);
 assert.equal(q.paybackMonths,2);
});
test('dados de usuário são normalizados sem permitir conteúdo ou campos arbitrários',()=>{
 const q=cleanQuote({client:' <Opuz> ',project:' BI de obras ',activities:[{name:' Integração ',hours:'12'},{name:'A',hours:0}],hourlyCost:'65',notes:'  orçamento  ',marginPct:33,unknown:'secret'});
 assert.equal(q.client,'<Opuz>');
 assert.equal(q.activities.length,1);
 assert.equal(q.activities[0].hours,12);
 assert.equal(q.hourlyCost,65);
 assert.equal(q.unknown,undefined);
});
test('proposta textual inclui ressalva de escopo e não gera compromisso de contrato',()=>{
 const q=quoteDefaults();
 q.client='Opuz Engenharia';q.project='Gestão de Obras';
 const output=proposalText(q,calculateQuote(q));
 assert.match(output,/Opuz Engenharia/);
 assert.match(output,/Gestão de Obras/);
 assert.match(output,/estimativa não vinculante/i);
 assert.match(output,/validação dos dados/i);
});
