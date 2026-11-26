import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const folder=mkdtempSync(join(app.getPath('temp'),'quiet-screen-episode-ui-'))
app.setPath('appData',folder)
const done=error=>{console.log(error?.stack??'PASS: season rollover, history selection, bulk clear, invalid counts, and reload persistence');app.exit(error?1:0)}
setTimeout(()=>done(Error('Timed out')),25000).unref()
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=async code=>{try{return await window.webContents.executeJavaScript(code)}catch(error){throw new Error('Renderer test failed while executing: '+code,{cause:error})}}
 try{
  await run(`
   window.clickText=(scope,text)=>[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.startsWith(text)).click();
   document.querySelector('#add').click();
   const form=document.querySelector('#title-form');
   form.elements.title.value='Episode test';
   form.elements.format.value='TV series';
   form.elements.episodic.checked=true;
   form.requestSubmit();
   clickText('#detail','Episodes');
   clickText('#detail','Edit season counts');
   document.querySelector('#seasons-form').elements.seasons.value='1, 2\\n2, 1';
   document.querySelector('#seasons-form').requestSubmit();
   clickText('#detail','Mark next episode');
   clickText('#detail','Mark next episode');
  `)
  assert.match(await run("document.querySelector('#detail').textContent"),/S2 E1/)
  await run("clickText('#detail','Mark next episode')")
  assert.equal(await run("[...document.querySelectorAll('#detail button')].some(b=>b.textContent.startsWith('Mark next'))"),false)
  await run(`
   window.confirm=()=>false;
   const selection=document.querySelector('#detail input[type=checkbox]');
   selection.click();
   clickText('#detail','Clear selected');
  `)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),3)
  await run("window.confirm=()=>true;clickText('#detail','Clear selected')")
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),0)
  assert.match(await run("document.querySelector('#detail').textContent"),/S1 E1/)
  await run(`
   clickText('#detail','Edit season counts');
   document.querySelector('#seasons-form').elements.seasons.value='1, 0';
   document.querySelector('#seasons-form').requestSubmit();
  `)
  assert.equal(await run("document.querySelector('#seasons-dialog').open"),true)
  await run("document.querySelector('#seasons-dialog').close()")
  const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve))
  window.reload();await loaded
  assert.equal(await run("QuietScreenApp.snapshot().library[0].seasons.length"),2)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),0)
  await run(`
    window.confirm=()=>true;
    window.clickText=(scope,text)=>[...document.querySelectorAll(scope+' button')].find(b=>b.textContent.startsWith(text)).click();
    document.querySelector('#titles button').click();
    clickText('#detail','Viewing history');
    clickText('#detail','Log past viewing');
    const viewing=document.querySelector('#view-form');
    viewing.elements.started.value='';
    viewing.elements.finished.value='';
    viewing.requestSubmit();
  `)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),3)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.every(view=>view.date===null)"),true)
  await run(`
    clickText('#detail','Episodes');
    document.querySelector('#detail input[type=checkbox]').click();
    clickText('#detail','Clear selected');
  `)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),0)
  const migratedReload=new Promise(resolve=>window.webContents.once('did-finish-load',resolve))
  window.reload();await migratedReload
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),0)
  await run(`
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>String(url).startsWith('/api/imdb-episodes?')
      ? Promise.resolve(Response.json({imdb:'tt0944947',seasons:[{season:1,count:10},{season:2,count:8}]}))
      : originalFetch(url,options);
    const saved=QuietScreenApp.snapshot();
    QuietScreenApp.apply({...saved,library:[{...saved.library[0],id:'legacy-imdb',imdb:'tt0944947',
      seasons:[],episodes:[],history:[{id:'legacy-finish',started:null,finished:null}]}]});
  `)
  for(let attempt=0;attempt<100&&!await run("QuietScreenApp.snapshot().library[0].seasons.length===2");attempt++){
    await new Promise(resolve=>setTimeout(resolve,50))
  }
  assert.equal(await run("QuietScreenApp.snapshot().library[0].seasons[0].count"),10)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.length"),18)
  assert.equal(await run("QuietScreenApp.snapshot().library[0].episodes.every(view=>view.date===null)"),true)
  await run(`
    const snapshot=QuietScreenApp.snapshot();
    const base=snapshot.library[0];
    QuietScreenApp.apply({...snapshot,library:[
      {...base,id:'steven',title:'Steven Universe',imdb:'',episodes:[],seasons:[],history:[],group:{mode:'auto',name:''}},
      {...base,id:'future',title:'Steven Universe Future',imdb:'',episodes:[],seasons:[],history:[],group:{mode:'auto',name:''}}
    ]});
  `)
  assert.equal(await run("document.querySelector('#titles .group-toggle').textContent"),'Steven Universe')
  assert.equal(await run("document.querySelectorAll('#titles .group-heading').length"),1)
  assert.match(await run("document.querySelector('#titles').textContent"),/Steven Universe Future/)
  done()
 }catch(e){done(e)}
}))
await import('../desktop/main.mjs')
