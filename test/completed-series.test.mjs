import assert from 'node:assert/strict'
import {test} from 'node:test'
import {completeSeriesEpisodes,clearEpisodeViewings,saveViewing,start,validLibrary} from '../library.mjs'
import '../sync/sync-core.js'
const S=globalThis.QuietScreenSync
const base={id:'show',title:'Show',format:'TV series',year:'',imdb:'',episodic:true,active:null,
 seasons:[{season:1,count:2},{season:2,count:1}],episodes:[],history:[]}
const history=(started,finished)=>({id:'watched',started,finished})
test('completion dates first episode from start and all remaining regular episodes from finish',()=>{
 const result=saveViewing(base,'past',history('2026-10-01','2026-11-01'))
 assert.deepEqual(result.episodes.map(v=>[v.season,v.episode,v.date]),[[1,1,'2026-10-01'],[1,2,'2026-11-01'],[2,1,'2026-11-01']])
 assert.ok(validLibrary([result]))
})
test('missing start uses finish and entirely undated completion stays undated',()=>{
 assert.ok(saveViewing(base,'past',history(null,'2026-11-01')).episodes.every(v=>v.date==='2026-11-01'))
 assert.ok(saveViewing(base,'past',history(null,null)).episodes.every(v=>v.date===null))
 assert.deepEqual(saveViewing(base,'past',history('2026-10-01',null)).episodes.map(v=>v.date),['2026-10-01',null,null])
})
test('old watched records are completed idempotently, including after backup round trip',()=>{
 const old={...base,history:[history(null,null)]}
 const migrated=completeSeriesEpisodes(old)
 assert.equal(migrated.episodes.length,3)
 assert.deepEqual(completeSeriesEpisodes(migrated),migrated)
 assert.deepEqual(completeSeriesEpisodes(JSON.parse(JSON.stringify(migrated))),migrated)
 assert.deepEqual(old.episodes,[])
})
test('metadata supplied later completes existing viewings; expanded seasons add missing episodes',()=>{
 const old={...base,seasons:[],history:[history(null,null)]}
 assert.equal(completeSeriesEpisodes(old),old)
 const filled=completeSeriesEpisodes({...old,seasons:base.seasons})
 const expanded=completeSeriesEpisodes({...filled,seasons:[...base.seasons,{season:3,count:2}]})
 assert.equal(expanded.episodes.length,5)
 assert.equal(completeSeriesEpisodes(expanded).episodes.length,5)
})
test('manual episode dates and duplicate viewings remain intact',()=>{
 const manual={id:'manual',season:1,episode:1,name:'Pilot',date:'2020-01-01',run:null}
 const filled=completeSeriesEpisodes({...base,episodes:[manual],history:[history('2026-10-01','2026-11-01')]})
 assert.deepEqual(filled.episodes[0],manual)
 assert.equal(filled.episodes.length,3)
})
test('rewatches complete their own run and preserve prior completions',()=>{
 const first=saveViewing(base,'past',history(null,'2026-10-01'))
 const started=start(first,'2026-11-01')
 const manual={id:'rewatch-pilot',season:1,episode:1,name:'',date:'2026-11-02',run:started.active.id}
 const done=saveViewing({...started,episodes:[...first.episodes,manual]},'finish',{id:'rewatch',started:'2026-11-01',finished:'2026-11-20'})
 assert.equal(done.episodes.length,6)
 assert.equal(done.active,null)
 assert.equal(done.episodes.find(v=>v.id==='rewatch-pilot').date,'2026-11-02')
 assert.equal(done.episodes.filter(v=>v.run===started.active.id).length,3)
 assert.deepEqual(done.episodes.slice(0,3),first.episodes)
})
test('clearing inferred viewings remains effective across reload and sync',()=>{
 const filled=saveViewing(base,'past',history(null,'2026-11-01'))
 const initial=S.update(S.empty(),{library:[filled]},'initial')
 const cleared=clearEpisodeViewings(filled,[filled.episodes[0].id])
 assert.equal(completeSeriesEpisodes(cleared).episodes.length,2)
 const changed=S.update(initial,{library:[cleared]},'clear')
 const projected=S.project(S.merge(changed,initial)).library[0]
 assert.deepEqual(completeSeriesEpisodes(projected),projected)
 assert.equal(projected.episodes.length,2)
})
test('editing completion dates adjusts inferred dates but retains explicit corrections',()=>{
 const filled=saveViewing(base,'past',history(null,'2026-11-01'))
 filled.episodes[1]={...filled.episodes[1],date:'2026-10-03',inferred:false}
 const edited=saveViewing(filled,'edit',history('2026-10-01','2026-11-02'),0)
 assert.deepEqual(edited.episodes.map(v=>v.date),['2026-10-01','2026-10-03','2026-11-02'])
 assert.equal(edited.history[0].coverage.length,2)
})
test('deterministic migration merges across devices without duplicate episode rows',()=>{
 const old={...base,history:[history(null,null)]}
 const a=S.update(S.empty(),{library:[completeSeriesEpisodes(old)]},'a')
 const b=S.update(S.empty(),{library:[completeSeriesEpisodes(old)]},'b')
 const merged=S.project(S.merge(a,b))
 assert.equal(merged.library[0].episodes.length,3)
 assert.ok(validLibrary(merged.library))
})
test('movies and unfinished shows gain no completed episodes',()=>{
 assert.equal(completeSeriesEpisodes(base),base)
 const movie={...base,episodic:false,history:[history(null,null)]}
 assert.equal(completeSeriesEpisodes(movie),movie)
})
test('completion includes configured specials while episode 1 still prefers series start',()=>{
 const result=saveViewing({...base,seasons:[{season:0,count:1},...base.seasons]},'past',history('2026-10-01','2026-11-01'))
 assert.equal(result.episodes.find(v=>v.season===0).date,'2026-11-01')
 assert.equal(result.episodes.find(v=>v.season===1&&v.episode===1).date,'2026-10-01')
})
