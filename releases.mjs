// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

export const RELEASES_URL='https://github.com/ayca-kaygusuz/quiet-screen/releases/latest';
const apiURL='https://api.github.com/repos/ayca-kaygusuz/quiet-screen/releases/latest';
const downloadRoot='https://github.com/ayca-kaygusuz/quiet-screen/releases/download/';
const maxInstaller=300*1024*1024;
import manifest from './package.json' with { type: 'json' };
export const APP_VERSION=manifest.version;
export function releaseVersionParts(value){let match=String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);if(!match)return null;let parts=match.slice(1).map(Number);return parts.every(Number.isSafeInteger)?parts:null}
export function newerVersion(candidate,current){let a=releaseVersionParts(candidate),b=releaseVersionParts(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]}return false}
export function releaseSafeDownload(value){try{let u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(u.origin==='https://github.com'&&u.pathname.startsWith('/ayca-kaygusuz/quiet-screen/releases/download/')||['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))}catch{return false}}
export async function releaseGet(url,fetcher,signal,installer=false){
  for(let redirects=0;redirects<5;redirects++){
    if(url!==apiURL&&!releaseSafeDownload(url))throw Error('Untrusted update download');
    const response=await fetcher(url,{redirect:'manual',headers:{Accept:url===apiURL?'application/vnd.github+json':'application/octet-stream','User-Agent':'QuietScreen updater'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(installer?600000:20000)]):AbortSignal.timeout(installer?600000:20000)});
    if(response.status>=300&&response.status<400){url=new URL(response.headers.get('Location'),url).href;continue}
    if(url===apiURL&&response.status===404)throw Object.assign(Error('GitHub release is unavailable.'),{code:'RELEASE_UNAVAILABLE'});
    if(!response.ok)throw Error('Update service unavailable');return response;
  }
  throw Error('Too many update redirects');
}
async function limitedText(response,limit){
 const reader=response.body?.getReader();if(!reader)throw Error('Update metadata unavailable');
 let length=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw Error('Update metadata too large');text+=decoder.decode(value,{stream:true})}return text+decoder.decode()}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function updateFilename(version,kind='windows'){
 if(!releaseVersionParts(version))throw Error('Invalid update version');
 if(kind!=='windows')throw Error('Unsupported update platform');
 return `Quiet-Screen-Setup-${version}-x64.exe`;
}
export async function latestUpdate(current,{fetcher=fetch,signal,kind='windows'}={}){
  let release=JSON.parse(await limitedText(await releaseGet(apiURL,fetcher,signal),256*1024));
  if(release.draft||release.prerelease||!newerVersion(release.tag_name,current))return null;
  let version=releaseVersionParts(release.tag_name).join('.'),filename=updateFilename(version,kind);
  let asset=(release.assets||[]).find(a=>a.name===filename),checksum=(release.assets||[]).find(a=>a.name==='SHA256SUMS.txt');
  let expectedRoot=downloadRoot+encodeURIComponent(release.tag_name)+'/';
  if(!asset||!checksum||asset.browser_download_url!==expectedRoot+filename||checksum.browser_download_url!==expectedRoot+'SHA256SUMS.txt'||!Number.isSafeInteger(asset.size)||asset.size<2||asset.size>maxInstaller)throw Error('The release has no valid update package');
  let manifest=await limitedText(await releaseGet(checksum.browser_download_url,fetcher,signal),20*1024);
  let entries=manifest.split(/\r?\n/).map(line=>line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i)).filter(m=>m&&m[2]===filename);
  if(entries.length!==1)throw Error('The installer checksum is missing or ambiguous');
  let sha256=entries[0][1].toLowerCase();
  if(asset.digest&&asset.digest!=='sha256:'+sha256)throw Error('The release checksums disagree');
  return {version,filename,url:asset.browser_download_url,size:asset.size,sha256};
}

export function createBrowserReleaseHandler({fetcher=fetch,clock=Date.now}={}){
 let cached=null,running=null;
 return async function(request){
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return new Response('Invalid origin',{status:403});
  try{
   if(!cached||clock()-cached.checkedAt>=300000){if(!running)running=latestUpdate(APP_VERSION,{fetcher,kind:'windows'}).then(update=>{cached={phase:update?'available':'up-to-date',version:update?.version||'',checkedAt:clock(),downloadUrl:update?'https://github.com/ayca-kaygusuz/quiet-screen/releases/tag/v'+update.version:''}}).finally(()=>{running=null});await running}
   return Response.json({...cached,currentVersion:APP_VERSION},{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error.code==='RELEASE_UNAVAILABLE')return Response.json({phase:'unavailable',checkedAt:clock(),currentVersion:APP_VERSION},{headers:{'Cache-Control':'no-store'}});return Response.json({error:'The update service could not be reached.'},{status:503,headers:{'Cache-Control':'no-store'}})}
 };
}
