// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

import {readFileSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {refreshGoogleToken} from '../sync/google-oauth.mjs';
import {googleWebConfiguration} from '../sync/web-account.mjs';

export async function deployHosted({accountId,token,clientId,credential,sourceSHA,name='quiet-screen',workerSource,fetcher=fetch,randomKey=()=>randomBytes(32).toString('base64'),newSubdomain=()=> 'quiet-screen-'+randomBytes(4).toString('hex'),checkGoogle=true}){
 if(!/^[a-f0-9]{32}$/.test(accountId||''))throw Error('Set CLOUDFLARE_ACCOUNT_ID to the account ID from your Cloudflare dashboard.');
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('Save CLOUDFLARE_API_TOKEN as a GitHub Actions secret.');
 if(!/^[a-z][a-z0-9-]{1,40}$/.test(name))throw Error('Choose a short lowercase Worker name using letters, numbers, and hyphens.');
 if(!/^[a-f0-9]{40}$/.test(sourceSHA||''))throw Error('Deploy a checked Git commit.');
 if(typeof workerSource!=='string'||!workerSource.includes('QuietScreenHostedWorker schema=1'))throw Error('Build the hosted Worker before deploying.');
 const config=googleWebConfiguration({clientId,credentialValue:credential});
 if(checkGoogle){
  try{await refreshGoogleToken({...config,refreshToken:'quiet-screen-preflight-not-a-user-token'},fetcher);throw Error('Unexpected Google preflight response.')}catch(error){if(error.oauthError!=='invalid_grant')throw Error('Google rejected the Web client configuration. Check its Actions variable and secret; no real user token was used.')}
 }
 const base='https://api.cloudflare.com/client/v4/accounts/'+accountId;
 async function api(path,settings={},allowMissing=false){
  const response=await fetcher(base+path,{...settings,headers:{...settings.headers,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(60000)});
  let data;try{data=await response.json()}catch{}
  if(allowMissing&&response.status===404)return null;
  if(!response.ok||data?.success!==true){const codes=(data?.errors||[]).map(e=>Number(e.code)).filter(Number.isFinite).join(',');throw Error(`Cloudflare request failed (HTTP ${response.status}${codes?'; codes '+codes:''}). Check the account ID, Workers token permissions, and free workers.dev setup.`)}
  return data.result;
 }
 let account=await api('/workers/subdomain',{},true);
 if(!account?.subdomain){
  const subdomain=newSubdomain();if(!/^quiet-screen-[a-z0-9-]{1,30}$/.test(subdomain))throw Error('Invalid generated free subdomain.');
  account=await api('/workers/subdomain',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({subdomain})});
 }
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(account?.subdomain||''))throw Error('Choose your free workers.dev subdomain in Cloudflare → Workers & Pages, then retry.');
 const origin='https://'+name+'.'+account.subdomain+'.workers.dev',path='/workers/scripts/'+name;
 const previous=await api(path+'/secrets',{},true);
 if(previous!==null&&!Array.isArray(previous))throw Error('Could not inspect the existing session-key names safely. No deployment was made.');
 const hasKey=previous?.some(item=>item.name==='QUIET_SCREEN_SESSION_KEY'&&item.type==='secret_text');
 const bindings=[
  {name:'QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID',type:'plain_text',text:config.clientId},
  {name:'QUIET_SCREEN_PUBLIC_ORIGIN',type:'plain_text',text:origin},
  {name:'QUIET_SCREEN_BUILD_SHA',type:'plain_text',text:sourceSHA},
  {name:'QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET',type:'secret_text',text:config.clientSecret},
  ...(!hasKey?[{name:'QUIET_SCREEN_SESSION_KEY',type:'secret_text',text:randomKey()}]:[])
 ];
 const metadata={main_module:'index.mjs',compatibility_date:'2026-11-01',bindings,keep_bindings:['secret_text'],logpush:false,observability:{enabled:false}};
 const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('index.mjs',new Blob([workerSource],{type:'application/javascript+module'}),'index.mjs');
 await api(path,{method:'PUT',body:form});
 await api(path+'/subdomain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,previews_enabled:false})});
 return {origin,sourceSHA,sessionKeyPreserved:!!hasKey,callback:origin+'/api/account/callback'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const result=await deployHosted({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,clientId:process.env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID,credential:process.env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET,sourceSHA:process.env.GITHUB_SHA,name:process.env.QUIET_SCREEN_WORKER_NAME||'quiet-screen',workerSource:readFileSync(new URL('../work/hosted/index.mjs',import.meta.url),'utf8')});
  console.log('Deployed Quiet Screen: '+result.origin);console.log('Google Web authorized redirect URI: '+result.callback);console.log(result.sessionKeyPreserved?'Existing browser sessions kept.':'Created the first encrypted browser-session key.');
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'origin='+result.origin+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Quiet Screen web deployment\n\nApp: ${result.origin}\n\nSource: ${result.sourceSHA}\n\nGoogle Web client authorized JavaScript origin: \`${result.origin}\`\n\nAuthorized redirect URI: \`${result.callback}\`\n\nGoogle consent and real-account sync still require a manual device check. No paid services, database, or custom domain were provisioned.\n`);
 }catch(error){console.error(error.message);process.exitCode=1}
}
