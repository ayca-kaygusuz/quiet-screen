// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

import './sync-core.js';
const Sync=globalThis.QuietScreenSync;
const API='https://www.googleapis.com/drive/v3/files';
export async function limitedJSON(response,limit=Sync.MAX_BYTES){
 if(Number(response.headers.get('Content-Length'))>limit)throw Error('The Drive copy is too large.');
 const reader=response.body?.getReader();let text='';
 if(reader){let total=0;const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('The Drive copy is too large.');text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}finally{await reader.cancel().catch(()=>{})}}
 else{text=await response.text();if(text.length>limit)throw Error('The Drive copy is too large.')}
 return JSON.parse(text);
}
export function createDriveStore({accessToken,fetcher=fetch}){
 async function call(url,options={}){
  for(let attempt=0;attempt<2;attempt++){
   const token=await accessToken(attempt>0),response=await fetcher(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(45000)});
   if(response.status===401&&attempt===0)continue;
   if(!response.ok){const e=Error(response.status===401?'Sign in to Google again to reconnect Drive.':response.status===403?'Google Drive access was refused. Check that Drive API and the app-data permission are enabled.':response.status===429?'Google Drive is busy. Your local changes are safe; try again later.':'Google Drive could not be reached. Your local changes are safe.');e.code=response.status===401?'SIGN_IN_REQUIRED':'DRIVE_UNAVAILABLE';throw e}
   return response;
  }
 }
 return {
  async list(){let files=[],pageToken;do{const u=new URL(API);u.search=new URLSearchParams({spaces:'appDataFolder',q:"trashed = false and appProperties has { key='quietScreen' and value='sync-v1' }",fields:'files(id,version,size,appProperties),nextPageToken',pageSize:'100',...(pageToken?{pageToken}:{})});const page=await limitedJSON(await call(u),1024*1024);if(!Array.isArray(page.files))throw Error('Invalid Drive file list.');files.push(...page.files);if(files.length>200)throw Error('Too many sync copies to reconcile safely. Export a backup before retrying.');pageToken=page.nextPageToken}while(pageToken);return files},
  async read(file){if(!/^[a-zA-Z0-9_-]+$/.test(file.id)||Number(file.size)>Sync.MAX_BYTES)throw Error('Invalid Drive file.');return Sync.validate(await limitedJSON(await call(API+'/'+file.id+'?alt=media')))},
  async create(state){
   Sync.validate(state);const id=crypto.randomUUID(),boundary='quietScreen'+id.replaceAll('-','');
   const metadata={name:'quiet-screen-sync-v1-'+id+'.json',parents:['appDataFolder'],appProperties:{quietScreen:'sync-v1',batch:id}};
   const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(state)+'\r\n--'+boundary+'--';
   return limitedJSON(await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,size,appProperties',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body}),1024*1024);
  },
  async remove(file){if(!/^[a-zA-Z0-9_-]+$/.test(file.id))throw Error('Invalid Drive file.');try{await call(API+'/'+file.id,{method:'DELETE'})}catch{/* Cleanup is optional. Never discard a locally saved edit because cleanup failed. */}}
 };
}
export async function reconcileDrive({state,store,cache=new Map(),readOnly=false}){
 const local=Sync.validate(state),files=await store.list(),copies=[],nextCache=new Map();let bytes=0;
 for(const file of files){const cacheKey=file.id+':'+file.version;const copy=cache.get(cacheKey)||await store.read(file);bytes+=JSON.stringify(copy).length;if(bytes>32*1024*1024)throw Error('The combined Drive copies are too large to reconcile safely.');copies.push(copy);nextCache.set(cacheKey,copy)}
 const remote=Sync.merge(...copies),merged=Sync.merge(remote,local);
 if(!readOnly&&((merged.registers.length&&!Sync.covers(remote,merged))||files.length>1)){
  // Create an immutable checkpoint first. Concurrent writers create separate files,
  // so a stale device can never overwrite a newer device's copy.
  const created=await store.create(merged);if(!created?.id)throw Error('Drive did not confirm the saved copy.');
  nextCache.set(created.id+':'+created.version,merged);
  for(let i=0;i<files.length;i++)if(Sync.covers(merged,copies[i])){await store.remove(files[i]);nextCache.delete(files[i].id+':'+files[i].version)}
 }
 return {state:merged,cache:nextCache,hasRemote:files.length>0||merged.registers.length>0};
}
