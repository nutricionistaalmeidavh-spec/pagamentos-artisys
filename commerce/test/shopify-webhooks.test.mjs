import test from 'node:test';
import assert from 'node:assert/strict';
import {registerShopifyWebhooks} from '../scripts/shopify-webhooks.mjs';
test('Shopify official app: installed client credentials register only missing topics at own HTTPS endpoint',async()=>{
 const requests=[],shop='85pits-mq.myshopify.com';
 const fetchImpl=async(url,init)=>{
  requests.push({url:String(url),body:String(init?.body||'')});
  if(String(url).includes('oauth/access_token'))return Response.json({access_token:'test-token-opaque',expires_in:86000});
  const q=JSON.parse(init.body);
  if(q.query.includes('webhookSubscriptions(first:')){
   return Response.json({data:{webhookSubscriptions:{nodes:[{id:'gid://shopify/WebhookSubscription/1',topic:'ORDERS_PAID',uri:'https://example.test/v1/webhooks/shopify'}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  }
  return Response.json({data:{webhookSubscriptionCreate:{webhookSubscription:{id:'gid://shopify/WebhookSubscription/2',topic:q.variables.topic,uri:q.variables.webhookSubscription.uri},userErrors:[]}}});
 };
 const out=await registerShopifyWebhooks({env:{SHOPIFY_STORE_DOMAIN:shop,SHOPIFY_CLIENT_ID:'client-id',SHOPIFY_CLIENT_SECRET:'client-secret',
   PUBLIC_BASE_URL:'https://example.test'},fetchImpl});
 assert.equal(out.created.length,2);
 assert.equal(out.existing.length,1);
 assert.ok(requests.some(r=>r.url.includes(shop+'/admin/oauth/access_token')));
 assert.equal(requests.filter(r=>r.body.includes('webhookSubscriptionCreate')).length,2);
});
test('Shopify cannot register insecure endpoints or use missing credentials',async()=>{
 await assert.rejects(()=>registerShopifyWebhooks({env:{SHOPIFY_STORE_DOMAIN:'85pits-mq.myshopify.com',
  SHOPIFY_CLIENT_ID:'client',SHOPIFY_CLIENT_SECRET:'secret',PUBLIC_BASE_URL:'http://example.test'}}),/https/i);
 await assert.rejects(()=>registerShopifyWebhooks({env:{SHOPIFY_STORE_DOMAIN:'85pits-mq.myshopify.com',
  PUBLIC_BASE_URL:'https://example.test'}}),/credentials/i);
});
