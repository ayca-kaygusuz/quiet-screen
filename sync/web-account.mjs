// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

import {googleClientID,googleDesktopCredential,googlePKCE,googleAuthorizationURL,exchangeGoogleCode,refreshGoogleToken,googleIdentity} from './google-oauth.mjs';
import {createDriveStore,reconcileDrive,limitedJSON} from './drive.mjs';
const WebAccountSync=globalThis.QuietScreenSync;
const webEncode=bytes=>btoa(String.fromCharCode(...bytes)),webDecode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));

export function googleWebConfiguration({clientId='',credentialValue=''}){
 let value=typeof credentialValue==='string'?credentialValue.trim():'';if(value.length>65536)throw Error('Web OAuth configuration is too large.');
 let declaredId='';if(value.startsWith('{')||value.startsWith('"')){
  let parsed;try{parsed=JSON.parse(value)}catch{throw Error('Use the Web client value or downloaded Web OAuth JSON in the server settings.')}
  if(typeof parsed==='string')value=parsed.trim();else{if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.installed)throw Error('The hosted web backend requires Web client credentials.');const web=parsed.web||parsed;declaredId=web.client_id;value=typeof web.client_secret==='string'?web.client_secret.trim():''}
 }
 clientId=typeof clientId==='string'?clientId.trim():'';if(declaredId&&clientId&&declaredId!==clientId)throw Error('Web OAuth credentials belong to another client.');clientId=clientId||declaredId;
 if(!googleClientID(clientId)||!googleDesktopCredential(value))throw Error('Web OAuth server configuration is incomplete.');return {clientId,clientSecret:value};
}

export function createWebAccount(env={},options={}){
 const fetcher=options.fetcher||fetch;let configuration=null,keyPromise;
 try{configuration=env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET?googleWebConfiguration({clientId:env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID,credentialValue:env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET}):options.desktopConfiguration||null}catch{}
 try{const bytes=webDecode(options.sessionKey||env.QUIET_SCREEN_SESSION_KEY||'');if(bytes.length===32)keyPromise=crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt'])}catch{}
 return {async handle(request){
  const u=new URL(request.url),origin=u.origin,visitor=request.headers.get('oai-authenticated-user-id')||'',secure=u.protocol==='https:',prefix=secure?'__Host-quiet-screen-':'quiet-screen-';
  if(env.QUIET_SCREEN_PUBLIC_ORIGIN&&origin!==env.QUIET_SCREEN_PUBLIC_ORIGIN)return new Response('Invalid origin',{status:403});
  const desktopAllowed=!options.desktopConfiguration||!!env.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname);
  const configured=!!configuration&&!!keyPromise&&desktopAllowed,action=u.pathname.slice('/api/account/'.length),headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  const cookies=new Map((request.headers.get('Cookie')||'').split(';').map(part=>part.trim().split(/=(.*)/s).slice(0,2)));
  const binding=purpose=>new TextEncoder().encode(origin+'\n'+visitor+'\n'+purpose);
  async function seal(value,purpose){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:binding(purpose)},await keyPromise,new TextEncoder().encode(JSON.stringify(value)));return webEncode(iv)+'.'+webEncode(new Uint8Array(cipher))}
  async function open(purpose){try{const raw=cookies.get(prefix+purpose);if(!raw||raw.length>7500)return null;const [iv,cipher]=raw.split('.'),plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:webDecode(iv),additionalData:binding(purpose)},await keyPromise,webDecode(cipher)),value=JSON.parse(new TextDecoder().decode(plaintext));return value.expires>Date.now()&&value.clientId===configuration.clientId?value:null}catch{return null}}
  function cookie(purpose,value,seconds){const serialized=prefix+purpose+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+(secure?'; Secure':'');if(serialized.length>4096)throw Error('The Google connection could not be remembered safely.');headers.append('Set-Cookie',serialized)}
  const json=(value,status=200)=>Response.json(value,{status,headers}),redirect=location=>{const copy=new Headers(headers);copy.set('Location',location);return new Response(null,{status:303,headers:copy})};
  if(!configured){if(action==='status'&&request.method==='GET')return json({mode:'local',configured:false,account:null,network:{metered:null,source:'browser'}});return json({error:'Google sign-in is not configured on this server. Your local library and backups are available.'},503)}
  const session=await open('session'),account=session?.account&&/^\d{1,100}$/.test(session.account.id)?session.account:null;
  if(action==='status'&&request.method==='GET'){
   const outcome=await open('outcome');if(outcome)cookie('outcome','',0);
   return json({mode:'web',configured:true,account,network:{metered:null,source:'browser'},rememberSupported:true,...(outcome?{error:outcome.message}:{})});
  }
  if(action==='start'&&request.method==='GET'){
   const requestOrigin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');if(requestOrigin&&requestOrigin!==origin||site&&!['same-origin','none'].includes(site))return json({error:'Start sign-in from Quiet Screen.'},403);
   const pkce=await googlePKCE(),redirectURI=origin+'/api/account/callback';cookie('login',await seal({...pkce,clientId:configuration.clientId,redirectURI,expires:Date.now()+5*60000},'login'),300);
   return redirect(googleAuthorizationURL({clientId:configuration.clientId,redirectURI,...pkce}));
  }
  if(action==='callback'&&request.method==='GET'){
   const login=await open('login');cookie('login','',0);
   if(!login||u.searchParams.get('state')!==login.state)return new Response('This sign-in response is invalid or expired. Return to Quiet Screen and sign in again.',{status:403,headers});
   try{
    if(u.searchParams.has('error')||!u.searchParams.get('code'))throw Error('Google sign-in was cancelled.');
    const tokens=await exchangeGoogleCode({...configuration,code:u.searchParams.get('code'),redirectURI:login.redirectURI,verifier:login.verifier},fetcher),identity=await googleIdentity(tokens.access_token,fetcher);
    if(typeof tokens.refresh_token!=='string')throw Error('Google did not allow a remembered connection. Sign in again.');
    cookie('session',await seal({clientId:configuration.clientId,account:identity,refreshToken:tokens.refresh_token,expires:Date.now()+180*86400000},'session'),180*86400);
   }catch(error){const message=error.code?error.message:'Google sign-in could not be completed. Try signing in again.';cookie('outcome',await seal({clientId:configuration.clientId,message,expires:Date.now()+60000},'outcome'),60)}
   return redirect('/?account=connected');
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(request.headers.get('Origin')!==origin||request.headers.get('X-Quiet-Screen-Account')!=='1')return json({error:'Invalid account request'},403);
  if(action==='signout'){cookie('session','',0);cookie('login','',0);return json({mode:'web',configured:true,account:null})}
  if(action==='sync'){
   if(!account)return json({error:'Sign in to Google to sync.',code:'SIGN_IN_REQUIRED'},401);
   try{
    const data=await limitedJSON(request,WebAccountSync.MAX_BYTES+2048);if(data.accountId!==account.id)return json({error:'This request belongs to a different account.'},403);
    let token;const store=createDriveStore({fetcher,accessToken:async force=>{if(!token||force){const refreshed=await refreshGoogleToken({...configuration,refreshToken:session.refreshToken},fetcher);token=refreshed.access_token;if(refreshed.refresh_token){session.refreshToken=refreshed.refresh_token;cookie('session',await seal(session,'session'),180*86400)}}return token}});
    const result=await reconcileDrive({state:data.readOnly===true?WebAccountSync.empty():data.state,store,readOnly:data.readOnly===true});return json({state:result.state,account,hasRemote:result.hasRemote});
   }catch(error){return json({error:error.code?error.message:'Drive could not be checked safely. Your local library is kept.',code:error.code||'SYNC_ERROR'},error.code==='SIGN_IN_REQUIRED'?401:400)}
  }
  return json({error:'Not found'},404);
 }};
}
