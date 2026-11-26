import {limitedJSON,reconcileDrive} from '../sync/drive.mjs';
const Sync=globalThis.QuietScreenSync;
// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

// Packaged after the shared Drive reconciliation implementation. It runs the
// same validation/merge/checkpoint rules locally, with no Google tokens in JS.
(function(root){
 let cache=new Map(),cacheAccount=null;
 root.QuietScreenHostedSync={async sync({accountId,state,readOnly=false}){
  if(!/^\d{1,100}$/.test(accountId))throw Error('Sign in to Google to sync.');
  if(cacheAccount!==accountId){cache=new Map();cacheAccount=accountId}
  let account;
  async function operation(name,{id,body}={}){
   const response=await fetch('/api/account/drive/'+name+(id?'?id='+encodeURIComponent(id):''),{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Quiet-Screen-Account':'1','X-Quiet-Screen-Account-Id':accountId},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok){let data;try{data=await response.json()}catch{}const error=Error(data?.error||'Drive could not finish this request. Your local library is kept.');error.code=data?.code;throw error}
   if(response.headers.get('X-Quiet-Screen-Account-Id')!==accountId)throw Error('The Google account changed. Your local library is kept.');
   return response;
  }
  const store={
   async list(){const data=await limitedJSON(await operation('list'),1024*1024);if(data.account?.id!==accountId||!Array.isArray(data.files)||data.files.length>200)throw Error('Invalid Drive checkpoint list.');account=data.account;return data.files},
   async read(file){if(!/^[a-zA-Z0-9_-]{1,200}$/.test(file.id)||Number(file.size)>Sync.MAX_BYTES)throw Error('Invalid Drive checkpoint.');return Sync.validate(await limitedJSON(await operation('read',{id:file.id})))},
   async create(value){Sync.validate(value);return limitedJSON(await operation('create',{body:value}),1024*1024)},
   async remove(file){try{await operation('remove',{id:file.id})}catch{/* Keep checkpoints when cleanup fails. */}}
  };
  const result=await reconcileDrive({state:readOnly?Sync.empty():state,store,cache,readOnly});
  if(cacheAccount===accountId)cache=result.cache;
  return {state:result.state,hasRemote:result.hasRemote,account};
 }};
})(globalThis);
