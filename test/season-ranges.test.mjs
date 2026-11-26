import test from 'node:test'
import assert from 'node:assert/strict'
import {logSeasonRange,seriesReleaseTargets,start,validLibrary,validPoster,releaseProgress} from '../library.mjs'
import {serveApp} from '../app-response.mjs'
const base=()=>({id:'elementary',title:'Elementary',format:'TV series',year:'2012',imdb:'tt2191671',episodic:true,active:{id:'watching',started:null},history:[],episodes:[],seasons:Array.from({length:7},(_,i)=>({season:i+1,count:2}))})

test('a season range logs missing episodes without ending an active viewing or inventing dates',()=>{
 const title=base(), result=logSeasonRange(title,1,6)
 assert.equal(result.added,12)
 assert.equal(result.title.active,title.active)
 assert.ok(result.title.episodes.every(e=>e.date===null&&e.run==='watching'))
 assert.ok(validLibrary([result.title]))
 assert.equal(logSeasonRange(result.title,1,6).added,0)
 const again=start({...result.title,active:null},'2026-11-26')
 assert.equal(logSeasonRange(again,1,1,'2026-11-26').added,2)
 assert.equal(title.episodes.length,0)
})

test('season ranges preserve manual dates, validate gaps, skip future releases and allow manual unknown-date logs',()=>{
 const title=base()
 title.episodes=[{id:'pilot',season:1,episode:1,name:'Pilot',date:'2020-01-01',run:'watching'}]
 const result=logSeasonRange(title,1,1)
 assert.equal(result.added,1)
 assert.equal(result.title.episodes[0],title.episodes[0])
 assert.throws(()=>logSeasonRange(title,2,1))
 assert.throws(()=>logSeasonRange({...title,seasons:[{season:1,count:2},{season:3,count:2}]},1,3),/missing/)
 assert.throws(()=>logSeasonRange(title,1,1,'2026-02-30'))
 title.releases={imdb:title.imdb,show:1,checkedAt:Date.now(),episodes:[{season:1,episode:1,name:'Pilot',airdate:'2099-01-01',airstamp:null},{season:1,episode:2,name:'Unknown',airdate:null,airstamp:null}]}
 assert.equal(logSeasonRange({...title,episodes:[]},1,1).added,1)
 assert.equal(logSeasonRange({...title,episodes:[]},1,1).skipped,1)
})

test('batch release targets skip movies and known ended series by default',()=>{
 const ended={...base(),id:'ended',releases:{imdb:'tt2191671',ended:true}}
 const movie={...base(),id:'movie',format:'Movie'}
 const missing={...base(),id:'missing',imdb:''}
 const titles=[base(),ended,movie,missing]
 assert.deepEqual(seriesReleaseTargets(titles).map(t=>t.id),['elementary'])
 assert.deepEqual(seriesReleaseTargets(titles,true).map(t=>t.id),['elementary','ended'])
 assert.equal(seriesReleaseTargets([{...ended,imdb:'tt11737520'}]).length,1)
})

test('rewatching old episodes does not create lifetime new releases',()=>{
 const title=base()
 title.episodes=[{id:'first',season:1,episode:1,name:'',date:null,run:null}]
 title.releases={imdb:title.imdb,show:1,checkedAt:Date.now(),episodes:[{season:1,episode:1,name:'',airdate:'2020-01-01',airstamp:null}]}
 assert.equal(releaseProgress(title).released.length,1)
 assert.equal(releaseProgress(title,Date.now(),true).released.length,0)
})

test('IMDb lookup returns safe poster metadata and CSP permits only its image host',async()=>{
 const poster='https://m.media-amazon.com/images/M/test.jpg'
 assert.ok(validPoster(poster))
 for(const invalid of ['http://m.media-amazon.com/images/M/test.jpg','https://example.com/images/test.jpg','https://user:pass@m.media-amazon.com/images/test.jpg',null])assert.equal(validPoster(invalid),false)
 const response=await serveApp(new URL('https://app/api/imdb?q=Elementary'),'GET',async()=>Response.json({d:[{id:'tt2191671',l:'Elementary',qid:'tvSeries',i:{imageUrl:poster}},{id:'tt11737520',l:'One Piece',qid:'tvSeries',i:{imageUrl:'https://example.com/wrong.jpg'}}]}))
 const results=await response.json()
 assert.equal(results[0].poster,poster)
 assert.equal(results[1].poster,'')
 assert.equal(results[0].format,'TV series')
 const page=await serveApp(new URL('https://app/'),'GET')
 assert.match(page.headers.get('Content-Security-Policy'),/img-src https:\/\/m.media-amazon.com;/)
})
