// Product-specific commercial templates for the existing Pagamentos ArtiSys catalog.
// No Asaas credentials, price, connector secret, checkout or DB offer is created here.
export const PDV_SAAS_PRODUCT_ID='pdv-total-saas';
export const PDV_SAAS_OFFER_TEMPLATES=Object.freeze([
  {id:'pdv-total-saas-mensal',productId:PDV_SAAS_PRODUCT_ID,name:'PDV TOTAL — Mensal',
    description:'Assinatura mensal do PDV TOTAL para o estabelecimento cadastrado.',saleType:'monthly'},
  {id:'pdv-total-saas-anual',productId:PDV_SAAS_PRODUCT_ID,name:'PDV TOTAL — Anual',
    description:'Assinatura anual do PDV TOTAL para o estabelecimento cadastrado.',saleType:'yearly'}
].map(x=>Object.freeze({...x,deliveryMode:'webhook',artifactName:null,priceCents:null,
  active:false,category:'sistemas',status:'published'})));

export function pdvSaasTemplatesPending(offers){
  const existing=new Set(offers.map(x=>x.id));
  return PDV_SAAS_OFFER_TEMPLATES.filter(x=>!existing.has(x.id));
}

// A monthly or yearly SaaS entitlement must never be sold as a downloadable
// desktop license, without a webhook, or under a different product identity.
export function validPdvSaasOffer(id,productId,saleType,deliveryMode,artifactName){
  const template=PDV_SAAS_OFFER_TEMPLATES.find(x=>x.id===id);
  if(!template)return productId!==PDV_SAAS_PRODUCT_ID;
  return productId===PDV_SAAS_PRODUCT_ID && saleType===template.saleType &&
    deliveryMode==='webhook' && !artifactName;
}
