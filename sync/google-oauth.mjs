// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
export const googleClientID=value=>typeof value==='string'&&/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
export const googleDesktopCredential=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&/^[\x21-\x7e]+$/.test(value)&&!/^\*+$|^(redacted|hidden|masked|null|undefined)$/i.test(value);
export function googleDesktopConfiguration({clientId='',credentialValue=''}){
 let value=typeof credentialValue==='string'?credentialValue.trim():'';
 if(value.length>65536)throw Error('Desktop OAuth configuration is too large.');
 let declaredId='';
 if(value.startsWith('{')||value.startsWith('"')){
  let decoded;try{decoded=JSON.parse(value)}catch{throw Error('Save the downloaded Desktop OAuth JSON or its client_secret value in the Actions secret.')}
  if(typeof decoded==='string')value=decoded.trim();
  else{
   if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)||decoded.web)throw Error('Use Desktop OAuth credentials, not Web credentials.');
   const installed=decoded.installed||decoded;declaredId=installed.client_id;
   value=typeof installed.client_secret==='string'?installed.client_secret.trim():'';
  }
 }
 clientId=typeof clientId==='string'?clientId.trim():'';
 if(declaredId&&clientId&&declaredId!==clientId)throw Error('The saved Desktop JSON belongs to a different client ID.');
 clientId=clientId||declaredId;
 if(!googleClientID(clientId)||!googleDesktopCredential(value))throw Error('The release needs a Desktop OAuth client ID and an unmasked client_secret value or Desktop JSON.');
 return {clientId,clientSecret:value};
}
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function googlePKCE(){const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));return {verifier,challenge:base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),state:base64url(crypto.getRandomValues(new Uint8Array(32)))}}
export function googleAuthorizationURL({clientId,redirectURI,challenge,state}){
 if(!googleClientID(clientId))throw Error('Google sign-in needs a valid OAuth client ID.');
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectURI,response_type:'code',scope:'openid email profile '+DRIVE_SCOPE,access_type:'offline',prompt:'select_account consent',code_challenge:challenge,code_challenge_method:'S256',state});return u.href;
}
async function googleToken(parameters,fetcher){
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){
  let failure;try{failure=await response.json()}catch{}
  const known=new Set(['invalid_request','invalid_client','unauthorized_client','invalid_grant','access_denied','invalid_scope','temporarily_unavailable','server_error','deleted_client']);
  const reason=known.has(failure?.error)?failure.error:'unknown_error';
  const missing=reason==='invalid_request'&&typeof failure?.error_description==='string'&&/client_secret.*missing/i.test(failure.error_description);
  const configuration=missing||['invalid_client','unauthorized_client','deleted_client','invalid_scope'].includes(reason);
  const message=configuration?'This app build has incomplete or invalid Google sign-in configuration. Update Quiet Screen; the developer needs to correct the release settings.':reason==='invalid_grant'?'Google could not accept this sign-in attempt. Start Sign in with Google again.':reason==='access_denied'?'Google access was declined. Sign in again and approve the requested permissions.':reason==='invalid_request'?'Google rejected the sign-in request. The developer needs to check the app’s connection settings.':'Google could not be reached. Try again when you are online.';
  const error=Error(message);error.code=configuration?'GOOGLE_CLIENT_CONFIGURATION':['invalid_grant','access_denied'].includes(reason)?'SIGN_IN_REQUIRED':'GOOGLE_AUTH_UNAVAILABLE';error.oauthError=reason;throw error;
 }
 const data=await response.json();if(typeof data.access_token!=='string'||data.access_token.length>8000||data.scope&&!data.scope.split(' ').includes(DRIVE_SCOPE))throw Error('Google Drive app-data permission was not granted.');return data;
}
export const exchangeGoogleCode=({clientId,clientSecret,code,redirectURI,verifier},fetcher=fetch)=>googleToken({client_id:clientId,...(clientSecret?{client_secret:clientSecret}:{}),code,redirect_uri:redirectURI,code_verifier:verifier,grant_type:'authorization_code'},fetcher);
export const refreshGoogleToken=({clientId,clientSecret,refreshToken},fetcher=fetch)=>googleToken({client_id:clientId,...(clientSecret?{client_secret:clientSecret}:{}),refresh_token:refreshToken,grant_type:'refresh_token'},fetcher);
export async function googleIdentity(accessToken,fetcher=fetch){
 const response=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Google account details could not be verified.');const user=await response.json();
 if(typeof user.sub!=='string'||!/^\d{1,100}$/.test(user.sub)||typeof user.email!=='string'||user.email.length>320||user.email_verified!==true)throw Error('Google did not provide a verified account.');return {id:user.sub,email:user.email,name:typeof user.name==='string'?user.name.slice(0,200):user.email};
}
