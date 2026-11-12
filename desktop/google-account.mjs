import http from 'node:http';
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {googleClientID,googleDesktopCredential,googlePKCE,googleAuthorizationURL,exchangeGoogleCode,refreshGoogleToken,googleIdentity} from '../sync/google-oauth.mjs';
import {createDriveStore,reconcileDrive,limitedJSON} from '../sync/drive.mjs';

export function createGoogleAccount({profile,safeStorage,openExternal,fetcher=fetch,platform=process.platform,defaultClientId='',defaultClientSecret='',developerControls=false}){
 let session=null,clientId=defaultClientId,credentialClientId=defaultClientId,clientSecret=defaultClientSecret,pending=null,busy=false,error='',errorCode='',cache=new Map(),networkCache=null;
 const credentialFor=id=>id===credentialClientId&&googleDesktopCredential(clientSecret)?clientSecret:undefined;
 const configFile=join(profile,'google-connection.json'),tokenFile=join(profile,'drive-session.bin');
 const rememberSupported=()=>safeStorage.isEncryptionAvailable()&&(platform!=='linux'||['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(safeStorage.getSelectedStorageBackend?.()));
 async function atomic(path,data){await mkdir(profile,{recursive:true});await writeFile(path+'.tmp',data,{mode:0o600});await rename(path+'.tmp',path)}
 async function persist(value=session){if(value&&rememberSupported())await atomic(tokenFile,safeStorage.encryptString(JSON.stringify(value)));else await rm(tokenFile,{force:true})}
 const ready=(async()=>{
  try{const config=JSON.parse(await readFile(new URL('./google-client.generated.json',import.meta.url),'utf8'));if(googleClientID(config.clientId)&&(!clientId||config.clientId===clientId)){clientId=config.clientId;if(!clientSecret&&googleDesktopCredential(config.clientSecret)){credentialClientId=config.clientId;clientSecret=config.clientSecret}}}catch{}
  if(developerControls)try{const config=JSON.parse(await readFile(configFile,'utf8'));if(googleClientID(config.clientId))clientId=config.clientId}catch{}
  try{if(rememberSupported()){const saved=JSON.parse(safeStorage.decryptString(await readFile(tokenFile)));if(googleClientID(saved.clientId)&&(!clientId||saved.clientId===clientId)&&saved.account&&/^\d{1,100}$/.test(saved.account.id)&&typeof saved.refreshToken==='string'){clientId=saved.clientId;session=saved}}}catch(e){if(e.code!=='ENOENT')error='The saved Google connection could not be opened. Please sign in again.'}
 })();
 function status(){return {mode:'desktop',platform,configured:googleClientID(clientId)&&!!credentialFor(clientId),clientId,developerControls,account:session?.account||null,pending:!!pending,busy,error,errorCode,rememberSupported:rememberSupported()}}

 function closePending(){if(pending){clearTimeout(pending.timer);pending.server.close();pending=null}}
 async function start(){
  await ready;if(busy)throw Error('Wait for the current sync to finish.');if(!googleClientID(clientId)||!credentialFor(clientId))throw Error('This app build is missing Google sign-in configuration. Install the latest Quiet Screen release.');closePending();error='';errorCode='';
  const pkce=await googlePKCE();let redirectURI;
  const server=http.createServer(async(req,res)=>{
   const current=pending;let url;try{url=new URL(req.url,redirectURI)}catch{res.writeHead(400);res.end('Invalid callback.');return}
   if(!current||current.server!==server||req.method!=='GET'||req.headers.host!==new URL(redirectURI).host||url.pathname!=='/oauth/callback'||url.searchParams.get('state')!==pkce.state){res.writeHead(403);res.end('Invalid sign-in response.');return}
   // Claim this callback before asynchronous work; codes and state are single-use.
   closePending();busy=true;
   try{
    const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code)throw Error('Google sign-in was cancelled.');
    const tokens=await exchangeGoogleCode({clientId,clientSecret:credentialFor(clientId),code,redirectURI,verifier:pkce.verifier},fetcher),account=await googleIdentity(tokens.access_token,fetcher);
    if(typeof tokens.refresh_token!=='string')throw Error('Google did not allow a remembered connection. Try signing in again.');
    const nextSession={clientId,account,refreshToken:tokens.refresh_token};await persist(nextSession);session=nextSession;cache=new Map();error='';errorCode='';res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Referrer-Policy':'no-referrer'});res.end('<!doctype html><title>Quiet Screen</title><p>Connected to Google Drive. You can close this tab and return to Quiet Screen.</p>');
   }catch(e){error=e.message;errorCode=e.code||'ACCOUNT_ERROR';res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Quiet Screen could not complete sign-in. Return to the app for details.')}finally{busy=false}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});redirectURI=`http://127.0.0.1:${server.address().port}/oauth/callback`;
  const timer=setTimeout(()=>{if(pending?.server===server){error='Sign-in timed out. You can try again.';closePending()}},5*60*1000);timer.unref?.();pending={server,timer};
  try{await openExternal(googleAuthorizationURL({clientId,redirectURI,...pkce}))}catch{closePending();throw Error('The system browser could not be opened.')}return status();
 }
 async function sync(accountId,state,readOnly=false){
  await ready;if(!session||session.account.id!==accountId)throw Error('Sign in to this account before syncing.');if(busy||pending)throw Error('Wait for the current operation to finish.');busy=true;const active=session;let token;
  try{const store=createDriveStore({fetcher,accessToken:async force=>{if(!token||force){const result=await refreshGoogleToken({clientId:active.clientId,clientSecret:credentialFor(active.clientId),refreshToken:active.refreshToken},fetcher);token=result.access_token;if(result.refresh_token){active.refreshToken=result.refresh_token;await persist()}}return token}});const result=await reconcileDrive({state:readOnly?globalThis.QuietScreenSync.empty():state,store,cache,readOnly});cache=result.cache;error='';return {state:result.state,account:active.account,hasRemote:result.hasRemote}}
  catch(e){error=e.message;throw e}finally{busy=false}
 }
 async function network(force=false){
  if(!force&&networkCache&&Date.now()-networkCache.checkedAt<30000)return networkCache;
  let metered=null;
  if(platform==='win32')metered=await new Promise(resolve=>{
   const command="$ErrorActionPreference='Stop'; [void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]; $p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); if($null -eq $p){'offline'}else{$c=$p.GetConnectionCost(); if($c.Roaming -or $c.OverDataLimit -or $c.ApproachingDataLimit -or ($c.NetworkCostType.ToString() -in @('Fixed','Variable'))){'metered'}elseif($c.NetworkCostType.ToString() -eq 'Unrestricted'){'unmetered'}else{'unknown'}}";
   execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:7000,maxBuffer:4096},(error,stdout)=>{const value=stdout?.trim();resolve(error?null:value==='metered'?true:value==='unmetered'?false:null)});
  });
  networkCache={metered,checkedAt:Date.now(),source:platform==='win32'?'Windows':'unavailable'};return networkCache;
 }
 async function handle(request){
  await ready;const u=new URL(request.url),action=u.pathname.slice('/api/account/'.length);try{
   if(action==='status'&&request.method==='GET')return Response.json({...status(),network:await network()},{headers:{'Cache-Control':'no-store'}});
   if(request.method!=='POST')return new Response('Method not allowed',{status:405});
   if(action==='start')return Response.json(await start());
   if(action==='cancel'){closePending();return Response.json(status())}
   if(action==='signout'){if(busy)throw Error('Wait for the current sync to finish.');closePending();session=null;cache.clear();error='';await persist();return Response.json(status())}
   if(action==='configure'){if(!developerControls)return new Response('Developer settings are unavailable in this build',{status:403});if(session||busy||pending)throw Error('Sign out before changing the Google connection.');const data=await limitedJSON(request,8192);if(!googleClientID(data.clientId))throw Error('Enter the Desktop OAuth client ID, ending in .apps.googleusercontent.com.');clientId=data.clientId;await atomic(configFile,JSON.stringify({clientId}));return Response.json(status())}
   if(action==='sync'){const data=await limitedJSON(request,globalThis.QuietScreenSync.MAX_BYTES+2048);const cost=await network(true);if(data.manual!==true&&data.meteredOverride!==false&&cost.metered===true)return Response.json({paused:true,network:cost});return Response.json(await sync(data.accountId,data.state,data.readOnly===true))}
   return new Response('Not found',{status:404});
  }catch(e){return Response.json({error:e.message,code:e.code||'ACCOUNT_ERROR'},{status:e.code==='SIGN_IN_REQUIRED'?401:400,headers:{'Cache-Control':'no-store'}})}
 }
 return {handle,ready,status,network,dispose:closePending};
}
