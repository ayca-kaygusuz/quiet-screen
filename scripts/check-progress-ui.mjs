import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-progress-')))
const timer=setTimeout(()=>finish(Error('Viewing progress UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: Watchlist episodes advance to Watching, complete once, preserve progress on reload, and movie resume timestamps and notes survive finishing.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 const click=(scope,text)=>run(`[...document.querySelectorAll(${JSON.stringify(scope)}+' button')].find(b=>b.querySelector('strong')?.textContent===${JSON.stringify(text)}||b.textContent.startsWith(${JSON.stringify(text)})).click()`)
 const title=id=>run(`QuietScreenApp.snapshot().library.find(t=>t.id===${JSON.stringify(id)})`)
 const reload=async()=>{const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.reload();await loaded}
 try {
  await run(`QuietScreenApp.apply({...QuietScreenApp.snapshot(),library:[
   {id:'show',title:'A series',format:'TV series',year:'',imdb:'',episodic:true,active:null,history:[],episodes:[],seasons:[{season:1,count:3}]},
   {id:'movie',title:'A movie',format:'Movie',year:'',imdb:'',episodic:false,active:null,history:[],episodes:[],seasons:[]}
  ]})`)
  await click('#titles','A series');await click('#detail','Episodes');await click('#detail','Mark next episode')
  const first=await title('show')
  assert.ok(first.active)
  assert.equal(first.episodes[0].run,first.active.id)
  assert.match(await run("document.querySelector('#detail').textContent"),/Watching/)
  assert.match(await run("document.querySelector('#detail').textContent"),/S1 E2/)
  await reload()
  await click('#titles','A series');await click('#detail','Episodes');await click('#detail','Mark next episode')
  assert.equal((await title('show')).active.id,first.active.id)
  assert.equal((await title('show')).episodes.length,2)
  await click('#detail','Mark next episode')
  const done=await title('show')
  assert.equal(done.active,null)
  assert.equal(done.history.length,1)
  assert.equal(done.episodes.length,3)
  await click('#detail','Overview');await click('#detail','Start rewatch');await click('#detail','Episodes')
  assert.match(await run("document.querySelector('#detail').textContent"),/S1 E1/)
  assert.notEqual((await title('show')).active.id,first.active.id)
  await click('#titles','A movie');await click('#detail','Start watching');await click('#detail','Save place & notes')
  await run(`{const f=document.querySelector('#playback-form');f.elements.position.value='01:99:00';f.requestSubmit()}`)
  assert.equal(await run("document.querySelector('#playback-dialog').open"),true)
  await run(`{const f=document.querySelector('#playback-form');f.elements.position.value='01:20:15';f.elements.position.dispatchEvent(new Event('input',{bubbles:true}));f.elements.notes.value='Stopped before the final act.\\nContinue tomorrow.';f.requestSubmit()}`)
  assert.equal((await title('movie')).active.position,4815)
  assert.equal(await run("document.querySelector('#playback-dialog').open"),false)
  await reload();await click('#titles','A movie')
  assert.match(await run("document.querySelector('#detail').textContent"),/Resume at 01:20:15/)
  assert.match(await run("document.querySelector('#detail').textContent"),/Continue tomorrow/)
  await click('#detail','Finish watching')
  await run("document.querySelector('#view-form').requestSubmit()")
  const movie=await title('movie')
  assert.equal(movie.active,null)
  assert.equal(movie.history[0].position,4815)
  assert.match(movie.history[0].notes,/Continue tomorrow/)
  await click('#detail','Viewing history')
  assert.match(await run("document.querySelector('#detail').textContent"),/Last saved position 01:20:15/)
  finish()
 }catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
