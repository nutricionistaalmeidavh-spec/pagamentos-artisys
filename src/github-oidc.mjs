/**
 * Verify GitHub Actions' short-lived OIDC assertion before permitting release
 * upload through the existing R2 binding. No Cloudflare API token or ADMIN_TOKEN
 * is distributed to GitHub. This verifier ONLY grants system-release routes.
 */
export const GITHUB_RELEASE_AUDIENCE='artisys-release-sync-r2';
const ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL=ISSUER+'/.well-known/jwks';
const ALLOWLIST=new Map([
 ['nutricionistaalmeidavh-spec/pagamentos-artisys','.github/workflows/sync-system-releases-r2.yml'],
]);
const toBytes=value=>{
 const padded=value.replace(/-/g,'+').replace(/_/g,'/');
 const text=atob(padded+'='.repeat((4-padded.length%4)%4));
 return Uint8Array.from(text,c=>c.charCodeAt(0));
};
const decodeJson=v=>JSON.parse(new TextDecoder().decode(toBytes(v)));
const looksJwt=x=>typeof x==='string'&&x.length>80&&x.length<10000&&x.split('.').length===3;
function validatedClaims(c,epochSeconds){
 const repo=c?.repository,workflow=ALLOWLIST.get(repo);
 if(!workflow||c.iss!==ISSUER||c.aud!==GITHUB_RELEASE_AUDIENCE)return false;
 if(c.ref!=='refs/heads/main'||c.sub!=='repo:'+repo+':ref:refs/heads/main')return false;
 if(c.workflow_ref!==repo+'/'+workflow+'@refs/heads/main')return false;
 if(!['push','workflow_dispatch'].includes(c.event_name))return false;
 if(!Number.isFinite(c.exp)||!Number.isFinite(c.iat)||!Number.isFinite(c.nbf))return false;
 if(c.nbf>epochSeconds+30||c.iat>epochSeconds+30||c.exp<=epochSeconds-30||c.exp-epochSeconds>600)return false;
 return true;
}
/** Reject invalid tokens, unsigned tokens, unknown repos, other branches/workflows and stale JWTs. */
export async function verifyReleaseGithubOidc(request,fetchImpl=fetch,epochSeconds=Math.floor(Date.now()/1000)){
 const authorization=request.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return false;
 const token=authorization.slice(7).trim();
 if(!looksJwt(token))return false;
 const parts=token.split('.');
 let hdr,payload;
 try{hdr=decodeJson(parts[0]);payload=decodeJson(parts[1]);}
 catch{return false;}
 if(hdr?.alg!=='RS256'||typeof hdr.kid!=='string'||hdr.kid.length>200||!validatedClaims(payload,epochSeconds))return false;
 try{
  const response=await fetchImpl(JWKS_URL,{headers:{accept:'application/json'},cf:{cacheEverything:true,cacheTtl:3600}});
  if(!response.ok)return false;
  const jwks=await response.json();
  const match=Array.isArray(jwks?.keys)?jwks.keys.find(k=>k.kid===hdr.kid&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256'):null;
  if(!match)return false;
  const pub=await crypto.subtle.importKey('jwk',{kty:'RSA',n:match.n,e:match.e,alg:'RS256',ext:true},
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',pub,toBytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
