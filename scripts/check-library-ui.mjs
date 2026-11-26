import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-library-')))
const timer=setTimeout(()=>finish(Error('Library layout UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: compact library and title actions, poster fallback, all six themes and narrow layouts.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 try {
  await run(`
   window.fetch=()=>Promise.resolve(Response.json([]));
   QuietScreenApp.apply({...QuietScreenApp.snapshot(),library:[
    {id:'show',title:'Elementary',format:'TV series',year:'2012',imdb:'tt2191671',poster:'https://m.media-amazon.com/images/M/quiet-screen-missing-test.jpg',episodic:true,active:{id:'run',started:null},history:[],episodes:[],seasons:Array.from({length:7},(_,i)=>({season:i+1,count:2}))},
    {id:'movie',title:'A movie',format:'Movie',year:'2024',imdb:'',poster:'',active:null,history:[],episodes:[],seasons:[]}
   ]});
   document.querySelector('#titles img').dispatchEvent(new Event('error'));
   document.querySelector('#titles button').click();
  `)
  assert.equal(await run("document.querySelectorAll('#titles img').length"),0)
  assert.equal(await run("document.querySelectorAll('#titles .poster-placeholder').length"),2)
  assert.equal(await run("getComputedStyle(document.querySelector('#detail .bundle-menu-actions')).display"),'none')
  assert.equal(await run("getComputedStyle(document.querySelector('.library-menu .bundle-menu-actions')).display"),'none')
  assert.equal(await run("document.querySelector('#list-tabs').hidden"),true)
  assert.match(await run("document.querySelector('#detail').textContent"),/Log seasons/)
  for(const width of [1160,420]) {
   window.setBounds({width,height:850})
   for(const theme of ['ink','sage','tide','rosewood','porcelain','apricot']) {
    await run(`document.documentElement.dataset.theme='${theme}'`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if(process.env.QUIET_SCREEN_CAPTURE_UI&&theme==='ink')writeFileSync(join(process.cwd(),'work/windows/library-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
    if(await run('document.documentElement.scrollWidth>innerWidth'))console.log(await run("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right})).slice(0,20)"))
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true,theme+' '+width)
   }
   await run("document.documentElement.dataset.theme='ink'")
   await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
   if(process.env.QUIET_SCREEN_CAPTURE_UI) {
    await run(`document.querySelector('#insights').open=false;document.querySelector('${width===420?'#detail':'.library-navigation'}').scrollIntoView({block:'start'});window.scrollBy(0,-110)`)
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    writeFileSync(join(process.cwd(),'work/windows/library-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
   }
  }
  await run("document.querySelector('#detail .bundle-menu summary').click()")
  assert.notEqual(await run("getComputedStyle(document.querySelector('#detail .bundle-menu-actions')).display"),'none')
  await run("document.querySelector('#detail .bundle-menu summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
  assert.equal(await run("document.querySelector('#detail .bundle-menu').open"),false)
  finish()
 }catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
