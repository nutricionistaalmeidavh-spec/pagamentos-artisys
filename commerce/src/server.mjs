import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCore,verifyShopifyHmac,verifyBridgeHmac,normalizeShopifyOrder,dispatchJobs} from './core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const portalHtml=fs.readFileSync(path.join(here,'../public/portal.html'));
const portalJs=fs.readFileSync(path.join(here,'../public/portal.js'));
const portalCss=fs.readFileSync(path.join(here,'../public/portal.css'));
const bool=(v)=>v===true||v==='true';
const baseHeaders={
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'x-frame-options':'DENY','cross-origin-resource-policy':'same-origin'
};
const json=(res,status,body,headers={})=>{
  res.writeHead(status,{...baseHeaders,'content-type':'application/json; charset=utf-8',...headers});
  res.end(JSON.stringify(body));
};
const cookie=(req)=>{
  const raw=String(req.headers.cookie||'');
  return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith('artisys_session='))?.slice(16)||'';
};
const eq=(x,y)=>{
  if(!x||!y)return false;
  const a=Buffer.from(String(x)),b=Buffer.from(String(y));
  return a.length===b.length&&requireTimingSafeEqual(a,b);
};
import {timingSafeEqual as requireTimingSafeEqual} from 'node:crypto';
async function readRaw(req,limit=1_048_576){
  const chunks=[];let length=0;
  for await(const part of req){
    length+=part.length;if(length>limit)throw Object.assign(Error('payload_too_large'),{status:413});
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function parseObject(raw){
  let value;try{value=JSON.parse(raw.toString('utf8'))}catch{throw Object.assign(Error('invalid_json'),{status:400})}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(Error('invalid_json_object'),{status:400});
  return value;
}
export function createHandler(core,config={}){
  const shop=String(config.shopifyStoreDomain||'').toLowerCase();
  const base=String(config.publicBaseUrl||'http://127.0.0.1:8789');
  const secure=base.startsWith('https://');
  const adminAuth=(req)=>String(config.adminToken||'').length>=32&&eq(
    String(req.headers.authorization||'').replace(/^Bearer /i,''),config.adminToken);
  const respondRedirect=(res,url,token)=>{
    const cookieHeader=token
      ?'artisys_session='+encodeURIComponent(token)+'; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800'+(secure?'; Secure':'')
      :'artisys_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'+(secure?'; Secure':'');
    res.writeHead(303,{...baseHeaders,location:url,'set-cookie':cookieHeader});res.end();
  };
  return async function handler(req,res){
    let target;try{target=new URL(req.url,'http://localhost')}catch{return json(res,400,{error:'invalid_url'})}
    const route=target.pathname,method=req.method;
    try{
      if(method==='GET'&&route==='/healthz')return json(res,200,{ok:true,service:'artisys-commerce-core',version:1});
      if(method==='GET'&&route==='/portal'){
        res.writeHead(200,{...baseHeaders,'content-type':'text/html; charset=utf-8',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
        return res.end(portalHtml);
      }
      if(method==='GET'&&route==='/portal.css'){
        res.writeHead(200,{...baseHeaders,'content-type':'text/css; charset=utf-8'});
        return res.end(portalCss);
      }
      if(method==='GET'&&route==='/portal.js'){
        res.writeHead(200,{...baseHeaders,'content-type':'text/javascript; charset=utf-8','content-security-policy':"default-src 'none'"});
        return res.end(portalJs);
      }
      if(method==='GET'&&route==='/portal/claim'){
        const session=core.consumePortalToken(target.searchParams.get('token')||'');
        return respondRedirect(res,session?'/portal':'/portal?invalid=1',session);
      }
      if(method==='GET'&&route==='/v1/portal/licenses'){
        const email=core.sessionEmail(decodeURIComponent(cookie(req)));
        return email?json(res,200,{email,licenses:core.listLicenses(email)}):json(res,401,{error:'authentication_required'});
      }
      if(method==='POST'&&route==='/v1/portal/logout'){
        core.logout(decodeURIComponent(cookie(req)));return respondRedirect(res,'/portal',null);
      }
      if(method==='POST'&&route==='/v1/portal/request-access'){
        const raw=await readRaw(req,2048),data=parseObject(raw);
        core.requestPortalAccess(data.email,base);
        return json(res,202,{ok:true,message:'Se houver licenças para esse e-mail, enviaremos as instruções quando o canal de e-mail estiver configurado.'});
      }
      if(route.startsWith('/v1/admin/')){
        if(!adminAuth(req))return json(res,401,{error:'admin_authorization_required'});
        if(method==='GET'&&route==='/v1/admin/jobs')return json(res,200,{items:core.listJobs()});
        if(method==='POST'&&route==='/v1/admin/portal-link'){
          const raw=await readRaw(req,2048),data=parseObject(raw);
          const link=core.createPortalLink(data.email,base);
          return link?json(res,200,{link}):json(res,404,{error:'no_eligible_purchase'});
        }
        if(method==='POST'&&route==='/v1/admin/dispatch'){
          const results=await dispatchJobs(core,config);
          return json(res,200,{processed:results.length,results});
        }
        return json(res,404,{error:'not_found'});
      }
      if(method==='POST'&&route==='/v1/webhooks/shopify'){
        if(!shop||!config.shopifyClientSecret)return json(res,503,{error:'shopify_not_configured'});
        const raw=await readRaw(req);
        if(!verifyShopifyHmac(raw,req.headers['x-shopify-hmac-sha256'],config.shopifyClientSecret))
          return json(res,401,{error:'invalid_signature'});
        const incomingShop=String(req.headers['x-shopify-shop-domain']||'').toLowerCase();
        if(incomingShop!==shop)return json(res,403,{error:'wrong_shop'});
        const topic=String(req.headers['x-shopify-topic']||'').toLowerCase();
        const eventId=String(req.headers['x-shopify-webhook-id']||'');
        if(!eventId||!['orders/paid','orders/cancelled','refunds/create'].includes(topic))
          return json(res,422,{error:'unsupported_shopify_event'});
        const normalized=normalizeShopifyOrder(parseObject(raw),topic,shop,eventId);
        return json(res,200,{ok:true,...core.receive(normalized)});
      }
      if(method==='POST'&&['/v1/ingest/mercadolivre','/v1/ingest/artisys-payments'].includes(route)){
        const isMl=route.endsWith('/mercadolivre');
        const secret=isMl?config.mercadoLivreBridgeSecret:config.paymentsBridgeSecret;
        if(!secret)return json(res,503,{error:'bridge_not_configured'});
        const raw=await readRaw(req);
        if(!verifyBridgeHmac(raw,req.headers['x-artisys-timestamp'],req.headers['x-artisys-signature'],secret))
          return json(res,401,{error:'invalid_signature'});
        const data=parseObject(raw);
        const source=isMl?'mercadolivre':'artisys-payments';
        if(data.source!==source||!data.eventId||!data.externalOrderId||!data.seller)
          return json(res,422,{error:'invalid_bridge_event'});
        if(isMl&&config.mercadoLivreSellerId&&String(data.seller)!==String(config.mercadoLivreSellerId))
          return json(res,403,{error:'wrong_seller'});
        return json(res,200,{ok:true,...core.receive(data)});
      }
      return json(res,404,{error:'not_found'});
    }catch(error){
      if(error.message==='invalid_order_event'||error.message==='unsupported_shopify_topic')return json(res,422,{error:error.message});
      return json(res,error.status===413?413:error.status===400?400:500,
        {error:error.status===413?'payload_too_large':error.status===400?'invalid_payload':'internal_error'});
    }
  };
}
function readJsonEnv(value,fallback){
  if(!value)return fallback;
  try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:fallback}
  catch{throw Error('invalid_json_environment')}
}
export function run(env=process.env){
  const catalog=JSON.parse(fs.readFileSync(path.join(here,'../catalog.json'),'utf8'));
  const dbPath=env.LICENSE_DB_PATH||path.join(process.cwd(),'data','commerce.sqlite');
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  const core=createCore({dbPath,masterKey:env.LICENSE_MASTER_KEY,catalog,publicBaseUrl:env.PUBLIC_BASE_URL||'http://127.0.0.1:8789'});
  const config={
    publicBaseUrl:env.PUBLIC_BASE_URL||'http://127.0.0.1:8789',
    adminToken:env.COMMERCE_ADMIN_TOKEN,
    shopifyStoreDomain:env.SHOPIFY_STORE_DOMAIN,
    shopifyClientSecret:env.SHOPIFY_CLIENT_SECRET,
    mercadoLivreBridgeSecret:env.MERCADOLIVRE_BRIDGE_SECRET,
    mercadoLivreSellerId:env.MERCADOLIVRE_SELLER_ID,
    paymentsBridgeSecret:env.PAYMENTS_BRIDGE_SECRET,
    crmConnector:readJsonEnv(env.CRM_CONNECTOR_JSON,null),
    mailConnector:readJsonEnv(env.MAIL_CONNECTOR_JSON,null),
    productConnectors:readJsonEnv(env.PRODUCT_CONNECTORS_JSON,{})
  };
  if(String(config.adminToken||'').length<32)throw Error('COMMERCE_ADMIN_TOKEN must have at least 32 characters');
  const server=http.createServer(createHandler(core,config));
  const timer=setInterval(()=>dispatchJobs(core,config).catch(()=>{}),60_000);
  timer.unref();
  server.listen(Number(env.PORT||8789),env.HOST||'127.0.0.1');
  const close=()=>{clearInterval(timer);server.close(()=>core.close())};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  return {server,core};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run();
