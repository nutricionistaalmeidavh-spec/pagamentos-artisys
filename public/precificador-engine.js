// Núcleo puro e sem dependências, compartilhado pela UI e pelos testes Node.
export const PRESETS=Object.freeze({
  obras:{label:'BI de obras',project:'Gestão de Obras',activities:[['Diagnóstico e indicadores',5],['Tratamento de dados',9],['Integrações e atualização',5],['Dashboards e métricas',14],['Testes e validação',5],['Treinamento e entrega',3]]},
  industria:{label:'BI industrial',project:'BI Industrial',activities:[['Diagnóstico e indicadores',6],['Tratamento de dados',12],['Integrações e atualização',8],['Dashboards e métricas',15],['Testes e validação',6],['Treinamento e entrega',3]]},
  planilhas:{label:'BI de planilhas',project:'Indicadores de Gestão',activities:[['Diagnóstico e indicadores',3],['Tratamento de dados',6],['Integrações e atualização',2],['Dashboards e métricas',8],['Testes e validação',3],['Treinamento e entrega',2]]},
  automacao:{label:'Automação de processos',project:'Automação Operacional',activities:[['Diagnóstico e regras',5],['Implementação e integração',18],['Validações e tratamento de falhas',8],['Testes',7],['Documentação e entrega',4]]},
  software:{label:'Sistema sob medida',project:'Sistema Personalizado',activities:[['Levantamento e arquitetura',12],['Interface e experiência',16],['Backend e banco de dados',30],['Integrações',12],['Testes e segurança',16],['Implantação e treinamento',8]]}
});
const numericFields=['hourlyCost','extraCosts','riskPct','taxesPct','marginPct','discountPct','roundTo','monthlySupport','hoursSavedPerMonth','clientHourValue','deliveryDays'];
export function quoteDefaults(preset='obras'){
 const selected=PRESETS[preset]||PRESETS.obras;
 return {preset:PRESETS[preset]?preset:'obras',client:'',contact:'',project:selected.project,notes:'',scope:'',activities:selected.activities.map(([name,hours])=>({name,hours})),hourlyCost:55,extraCosts:0,riskPct:15,taxesPct:6,marginPct:35,discountPct:0,roundTo:50,monthlySupport:0,hoursSavedPerMonth:0,clientHourValue:0,deliveryDays:20};
}
function asFiniteNumber(value,fallback=0){
 if(value===''||value==null)return fallback;
 const n=Number(value);
 return Number.isFinite(n)?n:fallback;
}
export function cleanQuote(input={}){
 const v=input&&typeof input==='object'?input:{},defaultQuote=quoteDefaults(v.preset);
 const clean={...defaultQuote};
 for(const key of ['client','contact','project','notes','scope']){
  clean[key]=String(v[key]??defaultQuote[key]).trim().slice(0,key==='notes'||key==='scope'?1000:140);
 }
 for(const field of numericFields){
  clean[field]=asFiniteNumber(v[field],defaultQuote[field]);
 }
 clean.activities=Array.isArray(v.activities)
  ?v.activities.slice(0,24).map(item=>({name:String(item?.name??'').trim().slice(0,90),hours:asFiniteNumber(item?.hours)})).filter(item=>item.name&&item.hours>0&&item.hours<=10000)
  :defaultQuote.activities;
 return clean;
}
function finiteBetween(value,name,min,max){
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(name);
 return value;
}
const cents=n=>Math.round((n+Number.EPSILON)*100)/100;
export function calculateQuote(input={}){
 const v={...quoteDefaults(input.preset),...input};
 if(!Array.isArray(v.activities))throw Error('activities');
 const activities=v.activities.map(a=>({name:String(a.name??'').trim(),hours:finiteBetween(Number(a.hours),'hours',0,10000)}));
 const hours=cents(activities.reduce((sum,a)=>sum+a.hours,0));
 const hourlyCost=finiteBetween(Number(v.hourlyCost),'hourlyCost',0,1000000);
 const extraCosts=finiteBetween(Number(v.extraCosts),'extraCosts',0,100000000);
 const riskPct=finiteBetween(Number(v.riskPct),'riskPct',0,100);
 const taxesPct=finiteBetween(Number(v.taxesPct),'taxesPct',0,99);
 const marginPct=finiteBetween(Number(v.marginPct),'marginPct',0,99);
 const discountPct=finiteBetween(Number(v.discountPct),'discountPct',0,100);
 const roundTo=finiteBetween(Number(v.roundTo??50),'roundTo',1,10000);
 const monthlySupport=finiteBetween(Number(v.monthlySupport??0),'monthlySupport',0,1000000);
 const hoursSavedPerMonth=finiteBetween(Number(v.hoursSavedPerMonth??0),'hoursSavedPerMonth',0,1000000);
 const clientHourValue=finiteBetween(Number(v.clientHourValue??0),'clientHourValue',0,1000000);
 if(taxesPct+marginPct>=100)throw Error('margin_sum');
 const directCost=cents(hours*hourlyCost+extraCosts);
 const reserve=cents(directCost*riskPct/100);
 const costBasis=cents(directCost+reserve);
 const hasBasis=costBasis>0;
 const breakEven=hasBasis?cents(costBasis/(1-taxesPct/100)):0;
 const targetPrice=hasBasis?cents(costBasis/(1-(taxesPct+marginPct)/100)):0;
 const suggestedPrice=hasBasis?cents(Math.ceil((targetPrice-0.0000001)/roundTo)*roundTo):0;
 const finalPrice=cents(suggestedPrice*(1-discountPct/100));
 const estimatedTaxes=cents(finalPrice*taxesPct/100);
 const estimatedProfit=cents(finalPrice-estimatedTaxes-costBasis);
 const effectiveMargin=finalPrice>0?cents(estimatedProfit/finalPrice*100):0;
 const monthlyValue=cents(hoursSavedPerMonth*clientHourValue);
 const paybackMonths=finalPrice>0&&monthlyValue>0?cents(finalPrice/monthlyValue):null;
 return {activities,hours,directCost,reserve,costBasis,breakEven,targetPrice,suggestedPrice,finalPrice,estimatedTaxes,estimatedProfit,effectiveMargin,belowBreakEven:hasBasis&&finalPrice<breakEven,belowTarget:hasBasis&&effectiveMargin+0.01<marginPct,hasBasis,monthlySupport,monthlyValue,paybackMonths};
}
export function proposalText(quote,calculated){
 const v=cleanQuote(quote),r=calculated??calculateQuote(v);
 const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
 return [
 'ARTISYS | ESTIMATIVA COMERCIAL',
 'Cliente: '+(v.client||'A definir'),
 'Projeto: '+(v.project||'A definir'),
 v.contact?'Contato: '+v.contact:null,
 '',
 'OBJETIVO E ESCOPO',
 v.scope||'Implementação dos indicadores e das funcionalidades definidos na reunião de diagnóstico.',
 'Entregas estimadas:',
 ...r.activities.filter(a=>a.hours>0).map(a=>'• '+a.name),
 v.notes?'Observações: '+v.notes:null,
 '',
 'INVESTIMENTO ESTIMADO: '+(r.hasBasis?brl(r.finalPrice):'A definir'),
 v.monthlySupport>0?'Suporte mensal opcional: '+brl(v.monthlySupport)+'/mês (contratação separada)':null,
 'Prazo indicativo: '+v.deliveryDays+' dias úteis após aprovação do escopo e disponibilização dos dados.',
 '',
 'Esta é uma estimativa não vinculante, sujeita à validação dos dados, integrações, requisitos e escopo. Não constitui contrato ou cobrança. Licenças e hospedagem pagas não são dependências obrigatórias; caso sejam solicitadas, serão aprovadas separadamente.'
 ].filter(line=>line!==null).join('\n');
}
