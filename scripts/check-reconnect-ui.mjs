import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-reconnect-')))
const timer=setTimeout(()=>finish(Error('Reconnect UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: same-account reconnect clears expired authorization, preserves library and resumes Drive sync.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 const wait=async condition=>{for(let i=0;i<150;i++){if(await run(condition))return;await new Promise(r=>setTimeout(r,50))}throw Error('Condition failed: '+condition)}
 try {
  await wait('typeof QuietScreenAccount!=="undefined"')
  await run(`(async()=>{
   window.expired=true;window.pending=false;window.callbackBusy=false;window.authError='';window.syncCalls=0;
   window.account={id:'101',email:'reader@example.invalid',name:'Reader'};
   window.connection=()=>({configured:true,mode:'desktop',account,pending,busy:callbackBusy,error:authError,network:{metered:false}});
   const state=QuietScreenSync.update(QuietScreenSync.empty(),{library:[{id:'saved',title:'Saved title',format:'Movie',year:'',imdb:'',active:null,history:[],episodes:[]}]},'fixture');
   localStorage.setItem('quiet-screen-account-101-v1',JSON.stringify({state,setupComplete:true,firstPull:true,dirty:false}));
   window.fetch=(url,options)=>{
    if(url.endsWith('/status'))return Promise.resolve(Response.json(connection()));
    if(url.endsWith('/start')){pending=true;return Promise.resolve(Response.json(connection()))}
    if(url.endsWith('/sync')){syncCalls++;return Promise.resolve(expired?Response.json({code:'SIGN_IN_REQUIRED',error:'Sign in again'},{status:401}):Response.json({account,state:JSON.parse(options.body).state}))}
    return Promise.resolve(Response.json({}));
   };
   await QuietScreenAccount.refresh();
   await QuietScreenAccount.sync(true);
  })()`)
  assert.match(await run("document.querySelector('#syncBadge').textContent"),/Reconnect/)
  await run("document.querySelector('#googleSignIn').click()")
  await wait('pending')
  await run("pending=false;callbackBusy=true;QuietScreenAccount.refresh()")
  assert.match(await run("document.querySelector('#syncBadge').textContent"),/Reconnect/)
  await run("callbackBusy=false;expired=false;QuietScreenAccount.refresh()")
  await wait("document.querySelector('#syncBadge').textContent==='Connected'")
  assert.equal(await run('QuietScreenApp.snapshot().library[0].id'),'saved')
  await wait('syncCalls>=2')
  assert.equal(await run('QuietScreenAccount.status().setupPending'),false)
  finish()
 }catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
