import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forwardPdvPlatformAdmin} from '../src/pdv-platform-admin.mjs';
const secret='central-bridge-secret-shared-only-with-pdv-2026',origin='https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev';
const env={PDV_TOTAL_PLATFORM_URL:origin,ARTISYS_PLATFORM_BRIDGE_SECRET:secret};
test('central finance admin signs bounded PDV requests without forwarding ADMIN_TOKEN',async()=>{
 let observed;
 const fake=async(url,options)=>{observed={url,options};return new Response(JSON.stringify({summary:{totalTenants:1}}),{status:200,headers:{'content-type':'application/json'}})};
 const r=await forwardPdvPlatformAdmin(env,{action:'summary'},{fetchImpl:fake,now:()=>1730000000000,nonce:()=> '87654321-aaaa-4bbb-8ccc-123456789012'});
 assert.equal(r.status,200);
 assert.equal(observed.url,origin+'/api/v1/integrations/artisys/platform');
 assert.equal(observed.options.method,'POST');
 assert.equal(observed.options.headers['content-type'],'application/json');
 assert.ok(/^sha256=[a-f0-9]{64}$/.test(observed.options.headers['x-artisys-platform-signature']));
 assert.ok(!JSON.stringify(observed).includes('ADMIN_TOKEN'));
 assert.deepEqual(await r.json(),{summary:{totalTenants:1}});
});
test('bridge accepts only tenant-management whitelist and rejects foreign arbitrary destinations',async()=>{
 const unsafe=['subscription','license.activate','delete','arbitrary'];
 for(const action of unsafe)
  await assert.rejects(forwardPdvPlatformAdmin(env,{action},{fetchImpl:()=>{throw Error('must not fetch');}}),/denied|invalid|forbidden/);
 await assert.rejects(forwardPdvPlatformAdmin({...env,PDV_TOTAL_PLATFORM_URL:'http://internal.local'},{action:'summary'}),/invalid|https/);
 await assert.rejects(forwardPdvPlatformAdmin({...env,ARTISYS_PLATFORM_BRIDGE_SECRET:''},{action:'summary'}),/configured|secret/);
});
test('public browser sees a single central admin section, not platform tokens or a second login',()=>{
 const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/admin.js',import.meta.url),'utf8');
 assert.match(html,/id="pdv-tenants-content"/);
 assert.match(js,/api\\('pdv\\/tenants'\\)/);
 assert.match(js,/pdv\\/approve/);
 assert.doesNotMatch(js,/PLATFORM_ADMIN_TOKEN|ARTISYS_PLATFORM_BRIDGE_SECRET/);
});
