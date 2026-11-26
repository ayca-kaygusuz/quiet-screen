import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'

app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-franchise-')))
const timer=setTimeout(()=>finish(Error('Franchise UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: on-demand lookup, checked standalones, explicit bundle review, per-bundle recheck, manual unbundle, and persistence.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 const wait=async condition=>{
  for(let attempt=0;attempt<100;attempt++){
   if(await run(condition))return
   await new Promise(resolve=>setTimeout(resolve,50))
  }
  throw Error('Condition not reached: '+condition)
 }
 try{
  await run(`
   window.confirm=()=>true;
   window.clickText=(selector,text)=>[...document.querySelectorAll(selector+' button')].find(button=>button.textContent.startsWith(text)).click();
   window.franchiseCalls=[];
   const actualFetch=window.fetch;
   window.fetch=(url,options)=>{
    if(url!=='/api/franchises')return actualFetch(url,options);
    const ids=JSON.parse(options.body).ids;
    franchiseCalls.push(ids);
    return Promise.resolve(Response.json({results:ids.map(imdb=>({imdb,checkedAt:'2026-11-26T12:00:00.000Z',
      entity:imdb==='tt0903747'?'Q1079':imdb==='tt3032476'?'Q14925221':'Q218035',
      links:imdb==='tt1266020'?[]:[{id:'Q113461786',relation:'P8345',label:'Breaking Bad'}]}))}));
   };
   const snapshot=QuietScreenApp.snapshot();
   QuietScreenApp.apply({...snapshot,library:[['bb','Breaking Bad','tt0903747'],['saul','Better Call Saul','tt3032476'],['parks','Parks and Recreation','tt1266020']].map(([id,title,imdb])=>({id,title,imdb,format:'Movie',year:'',active:null,episodes:[],history:[],group:{mode:'auto',name:''}}))});
  `)
  assert.equal(await run('franchiseCalls.length'),0)
  await run("document.querySelector('#franchise-lookup').click();document.querySelector('#run-franchise-lookup').click()")
  await wait("!document.querySelector('#franchise-scope').disabled")
  assert.equal(await run('franchiseCalls.length'),1)
  assert.match(await run("document.querySelector('#franchise-results').textContent"),/Parks and RecreationChecked · no matching connections/)
  assert.equal(await run("document.querySelectorAll('#titles .group-heading').length"),0)
  await run("document.querySelector('#franchise-results input[data-proposal]').click();document.querySelector('#apply-franchise-bundles').click();document.querySelector('#franchise-dialog').close()")
  assert.equal(await run("document.querySelectorAll('#titles .group-heading').length"),1)
  await run("document.querySelector('#franchise-lookup').click()")
  assert.equal(await run("document.querySelector('#run-franchise-lookup').disabled"),true)
  assert.match(await run("document.querySelector('#franchise-scope-summary').textContent"),/3 already checked/)
  await run("document.querySelector('#franchise-scope').value='all';document.querySelector('#franchise-scope').dispatchEvent(new Event('change'));document.querySelector('#run-franchise-lookup').click()")
  await wait("franchiseCalls.length===2&&!document.querySelector('#franchise-scope').disabled")
  assert.equal(await run('franchiseCalls[1].length'),3)
  await run("document.querySelector('#franchise-dialog').close();clickText('#titles','Recheck connections');document.querySelector('#run-franchise-lookup').click()")
  await wait("franchiseCalls.length===3&&!document.querySelector('#franchise-scope').disabled")
  assert.deepEqual(await run('franchiseCalls[2]'),['tt0903747','tt3032476'])
  await run(`
   document.querySelector('#franchise-dialog').close();
   clickText('#titles','Manage bundle');
   document.querySelector('#bundle-members input[value=saul]').click();
   document.querySelector('#bundle-form').requestSubmit();
  `)
  assert.equal(await run("QuietScreenApp.snapshot().library.find(title=>title.id==='saul').group.mode"),'none')
  await run("clickText('#titles','Manage bundle');document.querySelector('#unbundle-titles').click()")
  assert.equal(await run("document.querySelectorAll('#titles .group-heading').length"),0)
  const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve))
  window.reload();await loaded
  await run("document.querySelector('#franchise-lookup').click()")
  assert.equal(await run("document.querySelector('#run-franchise-lookup').disabled"),true)
  assert.equal(await run('QuietScreenApp.snapshot().library.every(title=>!!title.franchiseCheck)'),true)
  finish()
 }catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
