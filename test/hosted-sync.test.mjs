import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebAccount} from '../sync/web-account.mjs'

test('hosted browser previews read-only, streams checkpoints, and retains account binding without tokens in JS',async()=>{
 const origin='https://screen.example.invalid',jar=new Map(),files=new Map()
 const provider=async(url,options={})=>{
  const u=new URL(url)
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'openid email profile https://www.googleapis.com/auth/drive.appdata'})
  assert.equal(new Headers(options.headers).get('Authorization'),'Bearer synthetic-access')
  if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:'101',email:'reader@example.invalid',email_verified:true,name:'Reader'})
  assert.equal(u.hostname,'www.googleapis.com')
  if(u.pathname==='/drive/v3/files')return Response.json({files:[...files].map(([id,body])=>({id,version:'1',size:body.length}))})
  if(u.pathname==='/upload/drive/v3/files'){
   assert.ok(options.body instanceof ReadableStream)
   const multipart=await new Response(options.body).text(),parts=multipart.split('\r\n\r\n')
   assert.equal(JSON.parse(parts[1].split('\r\n--')[0]).appProperties.quietScreen,'sync-v1')
   const body=parts[2].slice(0,parts[2].lastIndexOf('\r\n--')),id='checkpoint'+files.size
   files.set(id,body);return Response.json({id,version:'1'})
  }
  const id=u.pathname.split('/').at(-1)
  if(options.method==='DELETE'){files.delete(id);return new Response(null,{status:204})}
  return new Response(files.get(id))
 }
 const backend=createWebAccount({QUIET_SCREEN_PUBLIC_ORIGIN:origin,QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID:'123456-testweb.apps.googleusercontent.com',QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET:'synthetic-client',QUIET_SCREEN_SESSION_KEY:Buffer.alloc(32,7).toString('base64')},{browserMerge:true,fetcher:provider})
 async function call(path,options={}){
  const response=await backend.handle(new Request(origin+'/api/account/'+path,{...options,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(options.method==='POST'?{Origin:origin,'X-Quiet-Screen-Account':'1','X-Quiet-Screen-Account-Id':'101'}:{}),...options.headers}}))
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1))}
  return response
 }
 const start=await call('start'),state=new URL(start.headers.get('Location')).searchParams.get('state')
 await call('callback?state='+encodeURIComponent(state)+'&code=synthetic-code')
 const status=await call('status').then(r=>r.json())
 assert.equal(status.syncTransport,'browser-v1')
 assert.ok(!JSON.stringify(status).includes('synthetic-access')&&!JSON.stringify(status).includes('synthetic-refresh'))
 const wrong=await call('drive/list',{method:'POST',headers:{'X-Quiet-Screen-Account-Id':'102'}})
 assert.equal(wrong.status,403)
 const actualFetch=globalThis.fetch
 try{
  globalThis.fetch=(url,options)=>call(String(url).replace('/api/account/',''),options)
  await import('../web/drive-client.js')
  const S=globalThis.QuietScreenSync
  const local=S.update(S.empty(),{library:[{id:'movie',title:'A long movie',format:'Movie',year:'',imdb:'',active:{id:'run',started:null,position:4815,notes:'Resume tomorrow'},history:[],episodes:[],seasons:[]}]},'fixture')
  const preview=await QuietScreenHostedSync.sync({accountId:'101',state:local,readOnly:true})
  assert.equal(files.size,0)
  assert.equal(preview.hasRemote,false)
  const saved=await QuietScreenHostedSync.sync({accountId:'101',state:local})
  assert.equal(S.project(saved.state).library[0].active.position,4815)
  assert.equal(files.size,1)
  const downloaded=await QuietScreenHostedSync.sync({accountId:'101',state:S.empty(),readOnly:true})
  assert.equal(S.project(downloaded.state).library[0].active.notes,'Resume tomorrow')
 }finally{globalThis.fetch=actualFetch}
 assert.equal((await call('sync',{method:'POST',body:'{}'})).status,409)
})
