import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {sharedAssets,mobileAssets,prepareMobile} from '../scripts/platform-assets.mjs'
import {createNativeAPI} from '../mobile/native-api.mjs'
import {createHostedWorker} from '../web/worker.mjs'
import {updateFilename} from '../releases.mjs'
import {spawnSync} from 'node:child_process'

test('every shared and mobile script parses before it can be embedded in a package',()=>{
 for(const file of mobileAssets.filter(name=>/\.m?js$/.test(name))){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'})
  assert.equal(result.status,0,file+'\n'+result.stderr)
 }
})

test('platform identities, source assets and native boundaries are explicit',()=>{
 const manifest=JSON.parse(readFileSync('platform-manifest.json'))
 assert.equal(manifest.appId,'quiet-screen')
 assert.equal(manifest.platforms.android.packageId,'com.quietscreen.android')
 assert.deepEqual(manifest.platforms.ios.deviceFamilies,['iPhone','iPad'])
 assert.ok(mobileAssets.includes('library.mjs')&&mobileAssets.includes('sync/sync-core.js'))
 assert.ok(!mobileAssets.some(name=>/private|google-client|web-account|google-oauth/.test(name)))
 assert.equal(updateFilename('0.8.0','android'),'Quiet-Screen-Android-0.8.0.apk')
 assert.equal(updateFilename('0.8.0','ios'),'Quiet-Screen-iOS-0.8.0-unsigned.ipa')
 assert.equal(updateFilename('0.8.0','linux'),'Quiet-Screen-0.8.0-linux-amd64.deb')
})

test('native adapter binds sync to the native account without exposing a token',async()=>{
 const calls=[]
 const api=createNativeAPI({platform:'android',rpc:async(method,args)=>{calls.push({method,args});if(method==='account.status')return {mode:'android',configured:true,account:{id:'101',email:'test@example.invalid'},network:{online:true,metered:false}};throw Error('unexpected native operation')}})
 const status=await api.handle(new Request('https://app/api/account/status'))
 assert.equal((await status.json()).mode,'android')
 const denied=await api.handle(new Request('https://app/api/account/sync',{method:'POST',headers:{'X-Quiet-Screen-Account':'1','Content-Type':'application/json'},body:JSON.stringify({accountId:'102',state:{}})}))
 assert.equal(denied.status,401)
 assert.ok(!calls.some(call=>call.method==='http'))
 const noHeader=await api.handle(new Request('https://app/api/account/start',{method:'POST'}))
 assert.equal(noHeader.status,403)
})

test('hosted worker checks origin, strips platform identity headers and serves only bundled assets',async()=>{
 const app=createHostedWorker({assets:{'/index.html':{type:'text/html',body:'<h1>Quiet Screen</h1>'},'/app.mjs':{type:'text/javascript',body:'// shared app'}}})
 const env={QUIET_SCREEN_PUBLIC_ORIGIN:'https://quiet-screen.example.workers.dev',QUIET_SCREEN_BUILD_SHA:'a'.repeat(40)}
 assert.equal((await app.fetch(new Request(env.QUIET_SCREEN_PUBLIC_ORIGIN+'/'),env)).status,200)
 assert.equal((await app.fetch(new Request('https://attacker.invalid/'),env)).status,403)
 assert.equal((await app.fetch(new Request(env.QUIET_SCREEN_PUBLIC_ORIGIN+'/private/drive-session.bin'),env)).status,404)
 const blocked=await app.fetch(new Request(env.QUIET_SCREEN_PUBLIC_ORIGIN+'/api/account/status',{headers:{Origin:'https://attacker.invalid'}}),env)
 assert.equal(blocked.status,403)
 const status=await app.fetch(new Request(env.QUIET_SCREEN_PUBLIC_ORIGIN+'/api/account/status',{headers:{'oai-authenticated-user-id':'untrusted'}}),env)
 assert.equal((await status.json()).configured,false)
 const update=await app.fetch(new Request(env.QUIET_SCREEN_PUBLIC_ORIGIN+'/api/update-check?source='+ 'b'.repeat(40)),env)
 assert.equal((await update.json()).phase,'available')
})

test('native source restricts hosts and credentials to its origin-bound main-frame bridge',()=>{
 const android=readFileSync('android/app/src/main/java/com/quietscreen/android/MainActivity.java','utf8')
 assert.ok(android.includes('if(!mainFrame'))
 assert.ok(android.includes('v3.sg.media-imdb.com')&&android.includes('api.tvmaze.com'))
 assert.ok(!android.includes('kitapyurdu')&&!android.includes('openlibrary.org'))
 const ios=readFileSync('ios/QuietScreen/NetworkPolicy.swift','utf8')
 assert.ok(ios.includes('v3.sg.media-imdb.com')&&!ios.includes('kitapyurdu'))
 const bridge=readFileSync('ios/QuietScreen/ScreenController.swift','utf8')
 assert.ok(bridge.includes('message.frameInfo.isMainFrame'))
})
