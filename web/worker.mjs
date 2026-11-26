import {createNativeAPI} from '../mobile/native-api.mjs'
import {createWebAccount} from '../sync/web-account.mjs'
import {APP_VERSION} from '../releases.mjs'
export async function workerFetch(input,settings={}){
 const reject=(settings.redirect||input?.redirect)==='error'
 const response=await fetch(input,{...settings,...(reject?{redirect:'manual'}:{})})
 if(reject&&response.status>=300&&response.status<400)throw Error('Credentialed redirects are not allowed.')
 return response
}
export function createHostedWorker({assets}){
 const catalogue=createNativeAPI({platform:'web',rpc:async(method,args)=>{
  if(method!=='http')throw Error('Unsupported public service')
  const response=await workerFetch(args.url,{method:args.method,headers:args.headers,...(args.body?{body:args.body}:{}),redirect:'manual',signal:AbortSignal.timeout(45000)})
  const body=await response.text();if(body.length>12*1024*1024)throw Error('Upstream response too large')
  return {status:response.status,headers:Object.fromEntries(response.headers),body}
 }})
 function secure(response){const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src https://m.media-amazon.com; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers})}
 return {async fetch(request,env={}){
  try{
   const url=new URL(request.url),get=request.method==='GET'
   if(url.protocol!=='https:'||url.origin!==env.QUIET_SCREEN_PUBLIC_ORIGIN)return secure(new Response('Invalid app origin',{status:403}))
   if(url.pathname==='/_health'&&get)return secure(Response.json({service:'Quiet Screen',version:APP_VERSION,source:env.QUIET_SCREEN_BUILD_SHA??'',googleConfigured:!!(env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID&&env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET&&env.QUIET_SCREEN_SESSION_KEY)}))
   if(url.pathname.startsWith('/api/')){
    const callback=url.pathname==='/api/account/callback'&&get,origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site')
    if(!callback&&(origin&&origin!==url.origin||site&&!['same-origin','none'].includes(site)))return secure(new Response('Open this request from Quiet Screen.',{status:403}))
    if(url.pathname.startsWith('/api/account/')){
     const headers=new Headers(request.headers);headers.delete('oai-authenticated-user-id')
     return secure(await createWebAccount(env,{browserMerge:true,fetcher:workerFetch}).handle(new Request(request,{headers})))
    }
    if(url.pathname==='/api/update-check'&&get)return secure(Response.json({phase:url.searchParams.get('source')&&url.searchParams.get('source')!==env.QUIET_SCREEN_BUILD_SHA?'available':'up-to-date',platform:'web',version:APP_VERSION,currentVersion:APP_VERSION,checkedAt:Date.now()}))
    return secure(await catalogue.handle(request))
   }
   if(!get&&request.method!=='HEAD')return secure(new Response('Method not allowed',{status:405}))
   if(url.pathname==='/web/build-info.js')return secure(new Response('globalThis.QuietScreenHostedBuild='+JSON.stringify({version:APP_VERSION,source:/^[a-f0-9]{40}$/.test(env.QUIET_SCREEN_BUILD_SHA??'')?env.QUIET_SCREEN_BUILD_SHA:''}),{headers:{'Content-Type':'text/javascript'}}))
   const asset=assets[url.pathname==='/'?'/index.html':url.pathname]
   if(!asset)return secure(new Response('Not found',{status:404}))
   return secure(new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type}}))
  }catch{return secure(Response.json({error:'This request could not finish. Your local library is kept.'},{status:503}))}
 }}
}
