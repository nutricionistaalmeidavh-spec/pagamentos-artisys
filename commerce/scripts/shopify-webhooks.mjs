import {fileURLToPath} from 'node:url';
import path from 'node:path';

const TOPICS=['ORDERS_PAID','ORDERS_CANCELLED','REFUNDS_CREATE'];
const LIST='query Webhooks($after:String){ webhookSubscriptions(first:50,after:$after){ nodes{ id topic uri } pageInfo{ hasNextPage endCursor } } }';
const CREATE='mutation CreateWebhook($topic:WebhookSubscriptionTopic!,$webhookSubscription:WebhookSubscriptionInput!){ webhookSubscriptionCreate(topic:$topic,webhookSubscription:$webhookSubscription){ webhookSubscription{ id topic uri } userErrors{ field message } } }';

function validate(env){
 const shop=String(env.SHOPIFY_STORE_DOMAIN||'').toLowerCase();
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))throw Error('invalid Shopify shop domain');
 if(!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)throw Error('Shopify app credentials required');
 const base=new URL(String(env.PUBLIC_BASE_URL||''));
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)
   throw Error('Shopify callback must be public HTTPS');
 const endpoint=new URL('/v1/webhooks/shopify',base);
 return {shop,endpoint:endpoint.href};
}
async function decode(response,label){
 if(!response.ok)throw Error(label+'_http_'+response.status);
 const result=await response.json();
 if(result.errors?.length||result.data?.errors?.length)throw Error(label+'_graphql_error');
 return result;
}
export async function registerShopifyWebhooks({env=process.env,fetchImpl=fetch}={}){
 const {shop,endpoint}=validate(env);
 const oauth=await decode(await fetchImpl('https://'+shop+'/admin/oauth/access_token',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET}).toString(),
   redirect:'error',signal:AbortSignal.timeout(10000)
 }),'shopify_oauth');
 const accessToken=String(oauth.access_token||'');
 if(!accessToken)throw Error('Shopify client credentials grant failed');
 const gql=async(query,variables={})=>{
  const response=await fetchImpl('https://'+shop+'/admin/api/2026-10/graphql.json',{
   method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':accessToken},
   body:JSON.stringify({query,variables}),redirect:'error',signal:AbortSignal.timeout(10000)
  });
  return (await decode(response,'shopify_graphql')).data;
 };
 const nodes=[];let cursor=null;
 for(let page=0;page<20;page++){
   const result=await gql(LIST,{after:cursor});
   const conn=result?.webhookSubscriptions;
   if(!conn?.nodes||!conn?.pageInfo)throw Error('invalid_shopify_webhook_query_response');
   nodes.push(...conn.nodes);
   if(!conn.pageInfo.hasNextPage)break;
   cursor=conn.pageInfo.endCursor;
   if(!cursor||page===19)throw Error('webhook_pagination_incomplete');
 }
 const created=[],existing=[];
 for(const topic of TOPICS){
  const sameTopic=nodes.filter(n=>n.topic===topic);
  if(sameTopic.some(n=>n.uri!==endpoint))
    throw Error('webhook_topic_already_registered_to_another_endpoint_'+topic);
  if(sameTopic.length){existing.push({topic,id:sameTopic[0].id});continue}
  const data=await gql(CREATE,{topic,webhookSubscription:{uri:endpoint}});
  const out=data?.webhookSubscriptionCreate;
  if(!out||out.userErrors?.length||!out.webhookSubscription?.id)
    throw Error('webhook_creation_failed_'+topic);
  created.push({topic,id:out.webhookSubscription.id});
 }
 return {shop,endpoint,created,existing};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 registerShopifyWebhooks().then(({shop,endpoint,created,existing})=>{
  console.log(JSON.stringify({shop,endpoint,created,existing},null,2));
 }).catch(error=>{console.error('Registration failed:',error.message);process.exitCode=1});
}
