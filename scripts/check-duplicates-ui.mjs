import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'

app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-duplicates-')))
const timer=setTimeout(()=>finish(Error('Duplicate UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: duplicate additions, Undo, explicit rewatch, history preservation, type filters and persistence.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 try {
  await run(`
    window.fetch=()=>Promise.resolve(Response.json({results:[]}));
    window.getTitle=()=>QuietScreenApp.snapshot().library.find(t=>t.id==='lucifer');
    window.addDuplicate=(status,finished='')=>{
      document.querySelector('#add').click();
      const f=document.querySelector('#title-form');
      f.elements.title.value='Replacement name';
      f.elements.imdb.value='https://www.imdb.com/title/tt4052886/';
      f.elements.status.value=status;
      f.elements.status.dispatchEvent(new Event('change'));
      f.elements.finished.value=finished;
      f.requestSubmit();
    };
    window.noticeAction=text=>[...document.querySelectorAll('#duplicate-feedback button')].find(b=>b.textContent===text).click();
    QuietScreenApp.apply({...QuietScreenApp.snapshot(),library:[
      {id:'lucifer',title:'Lucifer',imdb:'tt4052886',format:'TV series',year:'2016',episodic:false,active:null,history:[],episodes:[],group:{mode:'none',name:''}},
      {id:'movie',title:'A movie',imdb:'',format:'Movie',year:'',active:null,history:[],episodes:[],group:{mode:'none',name:''}}
    ]});
    addDuplicate('Watching');
  `)
  assert.equal(await run('QuietScreenApp.snapshot().library.length'),2)
  assert.equal(await run('getTitle().title'),'Lucifer')
  assert.ok(await run('getTitle().active'))
  assert.equal(await run("document.querySelector('#title-dialog').open"),false)
  await run("noticeAction('Undo')")
  assert.equal(await run('getTitle().active'),null)
  await run("addDuplicate('Watched')")
  assert.equal(await run('getTitle().history.length'),1)
  assert.equal(await run('getTitle().history[0].finished'),null)
  await run("addDuplicate('Watching')")
  assert.equal(await run('getTitle().active'),null)
  assert.ok(await run("document.querySelector('#duplicate-feedback').textContent.includes('Start rewatch')"))
  await run("noticeAction('Start rewatch')")
  assert.ok(await run('getTitle().active'))
  assert.equal(await run('getTitle().history.length'),1)
  await run("noticeAction('Undo')")
  assert.equal(await run('getTitle().active'),null)
  assert.equal(await run('getTitle().history.length'),1)
  await run("addDuplicate('Watched')")
  assert.equal(await run('getTitle().history.length'),1)
  assert.equal(await run("document.querySelectorAll('#duplicate-feedback button').length"),0)
  await run("document.querySelector('#library-type').value='movie';document.querySelector('#library-type').dispatchEvent(new Event('change'))")
  assert.equal(await run("document.querySelector('#count').textContent"),'1 title')
  assert.equal(await run("document.querySelector('#titles').textContent.includes('Lucifer')"),false)
  await run(`
    addDuplicate('Watching');
    noticeAction('Start rewatch');
    const snapshot=structuredClone(QuietScreenApp.snapshot());
    snapshot.library.find(t=>t.id==='lucifer').active.started='2026-11-01';
    QuietScreenApp.apply(snapshot);
    noticeAction('Undo');
  `)
  assert.equal(await run('getTitle().active.started'),'2026-11-01')
  assert.match(await run("document.querySelector('#duplicate-feedback').textContent"),/changed since then/)
  await run("addDuplicate('Watched','2026-10-01')")
  assert.equal(await run("document.querySelector('#title-dialog').open"),true)
  assert.equal(await run('getTitle().history.length'),1)
  await run("document.querySelector('#title-form').elements.finished.value='2026-11-26';document.querySelector('#title-form').elements.finished.dispatchEvent(new Event('input'));document.querySelector('#title-form').requestSubmit()")
  assert.equal(await run('getTitle().history.length'),2)
  await run("noticeAction('Undo')")
  assert.equal(await run('getTitle().history.length'),1)
  assert.equal(await run('getTitle().active.started'),'2026-11-01')
  const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve))
  window.reload();await loaded
  assert.equal(await run("document.querySelector('#library-type').value"),'movie')
  assert.equal(await run("document.querySelector('#count').textContent"),'1 title')
  await run("document.querySelector('#library-type').value='tv series';document.querySelector('#library-type').dispatchEvent(new Event('change'))")
  assert.equal(await run("document.querySelector('#titles').textContent.includes('Lucifer')"),true)
  assert.equal(await run("document.querySelector('#titles').textContent.includes('A movie')"),false)
  finish()
 } catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
