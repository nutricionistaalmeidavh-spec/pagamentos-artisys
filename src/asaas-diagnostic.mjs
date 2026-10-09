import {asaasRequest,gatewayConfig} from './asaas.mjs';

export const REQUIRED_CHECKOUT_EVENTS=Object.freeze([
 'CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED'
]);

function safeProviderStatus(error){
 const match=/^asaas_http_([0-9]{3})$/.exec(String(error?.message||''));
 if(match){
  const code=Number(match[1]);
  if(code===400)return 'bad_request';
  if(code===401)return 'unauthorized';
  if(code===403)return 'forbidden';
  if(code===404)return 'not_found';
  if(code===422)return 'unprocessable';
  if(code===429)return 'rate_limited';
  if(code>=500)return 'provider_unavailable';
  return 'provider_http_error';
 }
 if(error?.message==='asaas_not_configured')return 'key_missing';
 if(error?.message==='asaas_invalid_host')return 'invalid_api_host';
 return 'provider_unavailable';
}
function providerHttpCode(error){
 const match=/^asaas_http_([0-9]{3})$/.exec(String(error?.message||''));
 return match?Number(match[1]):null;
}
function webhookEndpoint(url){
 try{
  const base=new URL(String(url||''));
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.port||base.pathname!=='/'&&base.pathname!=='')return null;
  return base.origin+'/v1/webhooks/asaas';
 }catch{return null;}
}
function emptyWebhook(){
 return {status:'not_checked',found:false,enabled:null,interrupted:null,urlMatches:false,eventsConfigured:false,missingEvents:[]};
}

/** Read-only diagnostics. Never return provider records, access tokens, wallet IDs, or other private data. */
export async function diagnoseAsaas(env,fetchImpl){
 const output={
  environment:'unconfigured',
  apiAuthenticated:false,
  apiStatus:'not_checked',
  apiHttpCode:null,
  gatewayConfigured:!!env.ASAAS_API_KEY,
  webhookTokenConfigured:typeof env.ASAAS_WEBHOOK_TOKEN==='string'&&env.ASAAS_WEBHOOK_TOKEN.length>=32,
  webhookTokenVerified:false, // GET /webhooks cannot prove the secret matches the receiver.
  webhookEndpoint:webhookEndpoint(env.PUBLIC_BASE_URL),
  webhook:emptyWebhook(),
  configurationReady:false,
  paymentFlowVerified:false // Only a real Asaas event + reconciliation + fulfillment can prove this.
 };
 if(!output.gatewayConfigured){output.apiStatus='key_missing';return output;}
 let base;
 try{base=gatewayConfig(env);}catch(e){output.apiStatus=safeProviderStatus(e);return output;}
 output.environment=base==='https://api.asaas.com/v3'?'production':'sandbox';
 if(!output.webhookEndpoint){output.apiStatus='invalid_public_base_url';return output;}
 try{
  await asaasRequest(env,fetchImpl,'/wallets/',{method:'GET'});
  output.apiAuthenticated=true;output.apiStatus='authenticated';
 }catch(e){output.apiStatus=safeProviderStatus(e);output.apiHttpCode=providerHttpCode(e);return output;}
 try{
  const matching=[];
  for(let offset=0;offset<=400;offset+=100){
   const data=await asaasRequest(env,fetchImpl,'/webhooks?offset='+offset+'&limit=100',{method:'GET'});
   if(!Array.isArray(data?.data))throw Error('invalid_webhooks_response');
   for(const hook of data.data)if(hook?.url===output.webhookEndpoint)matching.push(hook);
   if(!data.hasMore)break;
   if(offset===400)throw Error('webhook_list_truncated');
  }
  if(matching.length===0){output.webhook.status='not_found';return output;}
  if(matching.length>1){output.webhook.status='duplicate';return output;}
  const hook=matching[0],availableEvents=Array.isArray(hook.events)?hook.events:[];
  output.webhook={
   status:'found',
   found:true,
   enabled:hook.enabled===true,
   interrupted:hook.interrupted===true,
   urlMatches:true,
   eventsConfigured:REQUIRED_CHECKOUT_EVENTS.every(e=>availableEvents.includes(e)),
   missingEvents:REQUIRED_CHECKOUT_EVENTS.filter(e=>!availableEvents.includes(e))
  };
  output.configurationReady=output.environment==='production'
   &&output.apiAuthenticated
   &&output.webhookTokenConfigured
   &&output.webhook.enabled
   &&!output.webhook.interrupted
   &&output.webhook.eventsConfigured
   &&output.webhook.urlMatches;
 }catch(e){
  output.webhook.status=safeProviderStatus(e);
  output.webhook.httpCode=providerHttpCode(e);
 }
 return output;
}
