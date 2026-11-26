import test from 'node:test'
import assert from 'node:assert/strict'
import {recordEpisodeViewing,reconcileEpisodeActivity,episodeProgress,nextEpisode,start,status,logSeasonRange,validLibrary,parsePosition,formatPosition,savePlayback,saveViewing} from '../library.mjs'
import '../sync/sync-core.js'
const base=()=>({id:'show',title:'Show',format:'TV series',year:'',imdb:'',episodic:true,active:null,history:[],episodes:[],seasons:[{season:1,count:3}]})
const episode=(n,date=null)=>({id:'e'+n,season:1,episode:n,name:'Episode '+n,date,run:null})

test('logging from Watchlist starts Watching and keeps the next episode in this same run',()=>{
 const first=recordEpisodeViewing(base(),episode(1))
 assert.equal(status(first),'Watching')
 assert.equal(first.active.started,null)
 assert.equal(first.episodes[0].run,first.active.id)
 assert.deepEqual(nextEpisode(episodeProgress(first),first.seasons),{season:1,episode:2})
 assert.equal(start(first),first)
 const second=recordEpisodeViewing(first,episode(2,'2026-11-26'))
 assert.deepEqual(nextEpisode(episodeProgress(second),second.seasons),{season:1,episode:3})
 assert.equal(second.episodes.length,2)
})

test('the final episode completes one viewing without creating duplicate episode logs',()=>{
 let title=base()
 for(let n=1;n<=3;n++)title=recordEpisodeViewing(title,episode(n))
 assert.equal(status(title),'Watched')
 assert.equal(title.episodes.length,3)
 assert.equal(title.history.length,1)
 assert.equal(title.history[0].finished,null)
 assert.ok(validLibrary([title]))
 assert.deepEqual(reconcileEpisodeActivity(title),title)
 const rewatch=start(title)
 assert.equal(status(rewatch),'Rewatching')
 assert.equal(episodeProgress(rewatch).length,0)
 assert.equal(logSeasonRange(rewatch,1,1).title.history.length,2)
})

test('legacy watchlist episode logs migrate deterministically and Start watching preserves them',()=>{
 const old={...base(),episodes:[episode(1),episode(2)]}
 const a=reconcileEpisodeActivity(old),b=reconcileEpisodeActivity(structuredClone(old))
 assert.deepEqual(a,b)
 assert.equal(status(a),'Watching')
 assert.equal(episodeProgress(start(old)).length,2)
 assert.deepEqual(nextEpisode(episodeProgress(a),a.seasons),{season:1,episode:3})
 assert.equal(reconcileEpisodeActivity({...old,episodes:[episode(1),episode(2),episode(3)]}).history.length,1)
 const alreadyStarted=reconcileEpisodeActivity({...old,active:{id:'old-start',started:null}})
 assert.equal(episodeProgress(alreadyStarted).length,2)
 assert.deepEqual(nextEpisode(episodeProgress(alreadyStarted),alreadyStarted.seasons),{season:1,episode:3})
})

test('unknown season boundaries do not declare completion; known release boundaries allow catching up',()=>{
 const unknown=recordEpisodeViewing({...base(),seasons:[]},episode(1))
 assert.equal(status(unknown),'Watching')
 const title={...base(),releases:{imdb:'tt11737520',show:1,checkedAt:Date.now(),episodes:[{season:1,episode:1,name:'Pilot',airdate:'2020-01-01',airstamp:null},{season:1,episode:2,name:'Future',airdate:'2099-01-01',airstamp:null}]},imdb:'tt11737520'}
 const caughtUp=recordEpisodeViewing(title,episode(1))
 assert.equal(status(caughtUp),'Watched')
 assert.equal(caughtUp.episodes.length,1)
})

test('backdated episodes complete with a valid date range, and individual repeats do not create whole-series rewatches',()=>{
 let title=start(base(),'2026-11-26')
 for(let n=1;n<=3;n++)title=recordEpisodeViewing(title,episode(n,'2020-01-01'))
 assert.equal(title.history[0].started,'2020-01-01')
 assert.ok(validLibrary([title]))
 const repeated=recordEpisodeViewing(title,{...episode(1),id:'repeat'})
 assert.equal(repeated.history.length,1)
})

test('movie timestamps parse, round-trip, reject malformed values and allow notes without a timestamp',()=>{
 assert.equal(parsePosition('45:30'),2730)
 assert.equal(parsePosition('01:20:15'),4815)
 assert.equal(formatPosition(4815),'01:20:15')
 assert.equal(parsePosition(''),null)
 for(const value of ['-1:00','1:60','01:65:00','abc','999:00:00'])assert.throws(()=>parsePosition(value))
 const movie={...base(),format:'Movie',episodic:false,seasons:[]}
 const saved=savePlayback(movie,null,'A reminder\nfor later')
 assert.equal(status(saved),'Watching')
 assert.equal(saved.active.position,null)
 assert.equal(saved.active.notes,'A reminder\nfor later')
 assert.ok(validLibrary([saved]))
})

test('movie place and notes survive backup and Drive sync, finishing, and a new rewatch',()=>{
 const movie={...base(),format:'Movie',episodic:false,seasons:[]}
 const saved=savePlayback(movie,4815,'Stopped before the last scene.')
 const S=globalThis.QuietScreenSync
 const restored=S.project(S.update(S.empty(),{library:[JSON.parse(JSON.stringify(saved))]},'device')).library[0]
 assert.equal(restored.active.position,4815)
 assert.equal(restored.active.notes,saved.active.notes)
 const finished=saveViewing(restored,'finish',{id:'done',started:restored.active.started,finished:null})
 assert.equal(finished.history[0].position,4815)
 assert.equal(finished.history[0].notes,saved.active.notes)
 const rewatch=start(finished)
 assert.equal(rewatch.active.position,undefined)
 assert.equal(rewatch.history[0].notes,saved.active.notes)
 assert.ok(validLibrary([rewatch]))
 assert.equal(validLibrary([{...saved,active:{...saved.active,position:-1}}]),false)
 assert.equal(validLibrary([{...finished,history:[{...finished.history[0],notes:'x'.repeat(10001)}]}]),false)
})
