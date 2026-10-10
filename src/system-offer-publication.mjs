import {CATALOG_DRAFTS} from './catalog-drafts.mjs';
import {SYSTEMS,defaultSystemVariant,downloadReadiness} from './delivery-catalog.mjs';
import {diagnoseAsaas} from './asaas-diagnostic.mjs';

// One-time rollout: do not regenerate binaries, modify kits, or touch OAuth/credentials.
export const SYSTEM_OFFER_ROLLOUT='four-system-offers-2026-10-10-v1';
const ids=Object.freeze([...SYSTEMS.keys()]);
const drafts=new Map(CATALOG_DRAFTS.filter(x=>SYSTEMS.has(x.id)).map(x=>[x.id,x]));
const firstArtifact=id=>defaultSystemVariant(id)?.key.slice('releases/'.length)||null;

function compatible(row,draft){
 return row&&row.product_id===draft.productId&&row.price_cents===draft.priceCents
  &&row.sale_type==='one_time'&&row.currency==='BRL'
  &&row.delivery_mode==='download'&&row.artifact_name===firstArtifact(row.id);
}
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();

// Each update is constrained by its audited canonical ID/price/variant.
// Cloudflare D1 batch is transactional; an existing kit record is never selected.
export async function publishVerifiedSystems(env,fetchImpl=fetch){
 const db=env.PAGAMENTO_ARTISYS_DB;
 if(!db)return {published:false,reason:'d1_not_configured'};
 if(await first(db,"SELECT id FROM audit_logs WHERE kind='system_offers_published' AND subject_id=? LIMIT 1",SYSTEM_OFFER_ROLLOUT))
  return {published:false,reason:'already_published'};
 if(ids.length!==4||drafts.size!==4)return {published:false,reason:'system_manifest_invalid'};
 if(env.PAYMENTS_ENABLED!=='true')return {published:false,reason:'payments_not_enabled'};
 if(!env.ASAAS_API_KEY||!env.ASAAS_WEBHOOK_TOKEN||!env.PUBLIC_BASE_URL)
  return {published:false,reason:'asaas_not_configured'};

 const selected=[];
 for(const id of ids){
  const row=await first(db,'SELECT * FROM offers WHERE id=?',id),draft=drafts.get(id);
  if(!compatible(row,draft))return {published:false,reason:'offer_mismatch',id};
  const readiness=await downloadReadiness(env,row);
  if(!readiness.ready)return {published:false,reason:readiness.reason||'release_not_verified',id};
  selected.push(row);
 }
 const diag=await diagnoseAsaas(env,fetchImpl);
 if(!diag.configurationReady)return {published:false,reason:'asaas_diagnostic_not_ready',apiStatus:diag.apiStatus,webhookStatus:diag.webhook.status};

 const stamp=new Date().toISOString();
 const batch=selected.map(row=>db.prepare(
  "UPDATE offers SET active=1,updated_at=? WHERE id=? AND product_id=? AND price_cents=? AND currency='BRL' AND sale_type='one_time' AND delivery_mode='download' AND artifact_name=? AND active=0"
 ).bind(stamp,row.id,row.product_id,row.price_cents,row.artifact_name));
 // Audit marker written only if the final four canonical rows are all active.
 const where=ids.map(()=>'?').join(',');
 batch.push(db.prepare(`
  INSERT OR IGNORE INTO audit_logs(id,kind,subject_id,details,created_at)
  SELECT ?,'system_offers_published',?,?,?
  WHERE (SELECT COUNT(*) FROM offers WHERE id IN (${where}) AND active=1
    AND product_id=id AND currency='BRL' AND sale_type='one_time' AND delivery_mode='download')=4
 `).bind(crypto.randomUUID(),SYSTEM_OFFER_ROLLOUT,JSON.stringify(ids),stamp,...ids));
 await db.batch(batch);
 const audit=await first(db,"SELECT id FROM audit_logs WHERE kind='system_offers_published' AND subject_id=? LIMIT 1",SYSTEM_OFFER_ROLLOUT);
 if(!audit)return {published:false,reason:'concurrent_offer_change'};
 return {published:true,ids};
}
