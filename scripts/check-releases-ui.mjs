import {app} from 'electron'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
app.setPath('appData',mkdtempSync(join(app.getPath('temp'),'quiet-screen-releases-')))
const timer=setTimeout(()=>finish(Error('Release UI check timed out')),30000)
function finish(error){clearTimeout(timer);console.log(error?.stack??'PASS: new season stays unwatched, released-only next episode, catch-up filter, future and unknown dates, offline preservation.');app.exit(error?1:0)}
app.once('browser-window-created',(_,window)=>window.webContents.once('did-finish-load',async()=>{
 const run=code=>window.webContents.executeJavaScript(code)
 const wait=async condition=>{for(let i=0;i<100;i++){if(await run(condition))return;await new Promise(r=>setTimeout(r,50))}throw Error('Condition failed: '+condition)}
 try {
  await run(`
   window.releaseFailure=false;window.extraEpisode=false;
   window.calls=[];
   window.clickText=text=>[...document.querySelectorAll('#detail button')].find(b=>b.textContent.startsWith(text)).click();
   window.fetch=(url)=>{
    calls.push(url);
    if(url.startsWith('/api/episode-releases')&&url.includes('tt2191671'))return Promise.resolve(Response.json({imdb:'tt2191671',checkedAt:Date.now(),show:1,ended:true,episodes:[]}));
    if(url.startsWith('/api/episode-releases'))return Promise.resolve(releaseFailure?new Response(null,{status:502}):Response.json({imdb:'tt11737520',checkedAt:Date.now(),show:46065,episodes:[
     {season:1,episode:1,name:'Pilot',airdate:'2023-08-31',airstamp:null},
     {season:2,episode:1,name:'Season two',airdate:'2026-01-01',airstamp:null},
     {season:3,episode:1,name:'New season',airdate:'2026-01-02',airstamp:null},
     {season:4,episode:1,name:'Future',airdate:'2099-01-01',airstamp:null},
     {season:4,episode:2,name:'Unknown',airdate:null,airstamp:null},
     ...(extraEpisode?[{season:3,episode:2,name:'Newly discovered',airdate:'2026-01-03',airstamp:null}]:[])
    ]}));
    if(url.startsWith('/api/imdb-episodes'))return Promise.resolve(Response.json({imdb:'tt11737520',seasons:[{season:1,count:1},{season:2,count:1},{season:3,count:1},{season:4,count:2}]}));
    return Promise.resolve(Response.json({configured:false,mode:'desktop',network:{}}));
   };
   QuietScreenApp.apply({...QuietScreenApp.snapshot(),library:[{id:'show',title:'One Piece',format:'TV series',year:'2023',imdb:'tt11737520',episodic:true,active:null,history:[{id:'watched',started:null,finished:null}],episodes:[],seasons:[{season:1,count:1},{season:2,count:1}]}]});
   document.querySelector('#titles button').click();clickText('Episodes');
  `)
  await wait("calls.some(url=>url.startsWith('/api/imdb-episodes'))&&!document.querySelector('#detail').textContent.includes('Checking episodes…')")
  assert.equal(await run('QuietScreenApp.snapshot().library[0].episodes.length'),2)
  assert.match(await run("document.querySelector('#detail').textContent"),/Mark next episode watched · S3 E1/)
  assert.match(await run("document.querySelector('#detail').textContent"),/Next announced: S4 E1/)
  await run("[...document.querySelectorAll('#filters button')].find(b=>b.textContent.startsWith('New episodes')).click()")
  assert.equal(await run("document.querySelector('#count').textContent"),'1 title')
  await run("clickText('Mark next episode')")
  assert.equal(await run('QuietScreenApp.snapshot().library[0].episodes.length'),3)
  assert.equal(await run("document.querySelector('#count').textContent"),'0 titles')
  assert.equal(await run("[...document.querySelectorAll('#detail button')].some(b=>b.textContent.startsWith('Mark next'))"),false)
  assert.match(await run("document.querySelector('#detail').textContent"),/Some release dates are unknown/)
  await run("releaseFailure=true;clickText('Check for new episodes')")
  await wait("document.querySelector('#detail').textContent.includes('Release-date check failed')")
  assert.equal(await run('QuietScreenApp.snapshot().library[0].releases.episodes.length'),5)
  assert.equal(await run('QuietScreenApp.snapshot().library[0].history.length'),1)
  await run(`
    releaseFailure=false;extraEpisode=true;
    const doc=QuietScreenApp.snapshot();
    QuietScreenApp.apply({...doc,library:[...doc.library,
      {id:'ended',title:'Elementary',format:'TV series',year:'2012',imdb:'tt2191671',episodic:true,active:null,history:[],episodes:[],seasons:[{season:1,count:1}],releases:{imdb:'tt2191671',checkedAt:Date.now(),show:1,ended:true,episodes:[]}},
      {id:'movie',title:'A movie',format:'Movie',year:'',imdb:'tt0000010',episodic:false,active:null,history:[],episodes:[],seasons:[]}
    ]});
    document.querySelector('#check-series-releases').click();
    document.querySelector('#run-series-releases').click();
  `)
  await wait("!document.querySelector('#run-series-releases').disabled")
  assert.match(await run("document.querySelector('#series-releases-results').textContent"),/One Piece.*Newly discovered/s)
  assert.equal(await run("calls.some(url=>url.startsWith('/api/episode-releases')&&url.includes('tt2191671'))"),false)
  assert.equal(await run("calls.some(url=>url.startsWith('/api/episode-releases')&&url.includes('tt0000010'))"),false)
  await run("document.querySelector('#include-ended-series').click();document.querySelector('#run-series-releases').click()")
  await wait("!document.querySelector('#run-series-releases').disabled")
  assert.equal(await run("calls.some(url=>url.startsWith('/api/episode-releases')&&url.includes('tt2191671'))"),true)
  await run("document.querySelector('#series-releases-results button').click()")
  assert.equal(await run("document.querySelector('#series-releases-dialog').open"),false)
  assert.match(await run("document.querySelector('#detail').textContent"),/Mark next episode watched · S3 E2/)
  finish()
 }catch(error){finish(error)}
}))
await import('../desktop/main.mjs').catch(finish)
