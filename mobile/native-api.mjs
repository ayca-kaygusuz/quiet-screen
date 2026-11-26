import {lookup} from '../catalogue.mjs'
import {createReleaseCatalog,releaseResponse} from '../episode-releases.mjs'
import {franchiseResponse} from '../franchise-lookup.mjs'
import {createDriveStore,reconcileDrive,limitedJSON} from '../sync/drive.mjs'
import {APP_VERSION,latestUpdate} from '../releases.mjs'

export function createNativeAPI({rpc,platform}){
 const S=globalThis.QuietScreenSync
 let busy=false,cache=new Map(),syncAccountId=null
 async function external(request){
  request=request instanceof Request?request:new Request(request)
  let url=request.url
  const body=['GET','HEAD'].includes(request.method)?null:await request.text()
  for(let hops=0;hops<5;hops++){
   const raw=await rpc('http',{url,method:request.method,headers:Object.fromEntries(request.headers),body,accountId:syncAccountId},request.signal)
   const response=new Response([204,205,304].includes(raw.status)?null:raw.body,{status:raw.status,headers:raw.headers})
   if(raw.status>=300&&raw.status<400){
    if(request.redirect==='error'||request.headers.has('Authorization'))throw Error('Unexpected upstream redirect')
    if(request.redirect==='manual')return response
    url=new URL(response.headers.get('Location'),url).href
    continue
   }
   return response
  }
  throw Error('Too many upstream redirects')
 }
 const fetcher=(url,settings={})=>external(new Request(url,settings))
 const catalog=createReleaseCatalog({fetcher})
 async function handle(request){
  const url=new URL(request.url)
  if(url.pathname==='/api/imdb'&&request.method==='GET')return lookup((url.searchParams.get('q')??'').trim(),fetcher)
  if(url.pathname==='/api/episode-releases'&&request.method==='GET')return releaseResponse(url,catalog)
  if(url.pathname==='/api/imdb-episodes'&&request.method==='GET'){
   const result=await releaseResponse(url,catalog)
   if(!result.ok)return result
   const data=await result.json(),counts=new Map()
   for(const e of data.episodes)counts.set(e.season,Math.max(counts.get(e.season)??0,e.episode))
   return Response.json({imdb:data.imdb,source:'TVmaze',checkedAt:data.checkedAt,seasons:[...counts].map(([season,count])=>({season,count}))})
  }
  if(url.pathname==='/api/franchises')return franchiseResponse(request,{fetcher})
  if(url.pathname==='/api/update-check'){
   try{const update=await latestUpdate(APP_VERSION,{kind:platform,fetcher});return Response.json({phase:update?'available':'up-to-date',version:update?.version??'',currentVersion:APP_VERSION,checkedAt:Date.now(),platform})}
   catch{return Response.json({error:'Updates could not be checked.'},{status:503})}
  }
  if(!url.pathname.startsWith('/api/account/'))return new Response('Not found',{status:404})
  const action=url.pathname.slice('/api/account/'.length)
  try{
   if(action==='status'&&request.method==='GET')return Response.json({...await rpc('account.status'),busy})
   if(request.method!=='POST'||request.headers.get('X-Quiet-Screen-Account')!=='1')return new Response('Invalid account request',{status:403})
   if(['start','cancel','signout'].includes(action)){if(busy)throw Error('Wait for the current sync.');if(action==='signout')cache.clear();return Response.json(await rpc('account.'+action))}
   if(action!=='sync')return new Response('Not found',{status:404})
   if(busy)throw Error('Sync is already running.')
   const data=await limitedJSON(request,S.MAX_BYTES+2048),status=await rpc('account.status')
   if(!status.account||status.account.id!==data.accountId)return Response.json({error:'Reconnect this Google account.',code:'SIGN_IN_REQUIRED'},{status:401})
   if(status.network?.online===false)throw Error('Offline. Your library is kept on this device.')
   if(!data.manual&&data.meteredOverride!==false&&status.network?.metered)return Response.json({paused:true,network:status.network})
   busy=true;syncAccountId=data.accountId
   try{
    const store=createDriveStore({accessToken:async force=>{if(force)await rpc('account.clearToken');return 'native-account'},fetcher})
    const result=await reconcileDrive({state:data.readOnly?S.empty():data.state,readOnly:data.readOnly===true,cache,store})
    const after=await rpc('account.status');if(after.account?.id!==data.accountId)throw Error('The Google account changed during sync.')
    cache=result.cache;return Response.json({state:result.state,account:after.account,hasRemote:result.hasRemote})
   }finally{busy=false;syncAccountId=null}
  }catch(error){return Response.json({error:error.message,code:error.code??'NATIVE_ACCOUNT_ERROR'},{status:error.code==='SIGN_IN_REQUIRED'?401:400})}
 }
 return {handle,external}
}
