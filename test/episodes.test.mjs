import assert from 'node:assert/strict'
import {test} from 'node:test'
import {clearEpisodeViewings,episodeProgress,nextEpisode,validSeasons,validLibrary,start} from '../library.mjs'
import '../sync/sync-core.js'
const S=globalThis.QuietScreenSync
const view=(id,season,episode,run=null)=>({id,season,episode,run,name:'',date:null})
const seasons=[{season:1,count:10},{season:2,count:2}]
const title={id:'show',title:'Show',format:'TV series',year:'',imdb:'',active:null,history:[],episodes:[],seasons}
const document=library=>({library,lists:[],preferences:{}})
test('next episode starts at the first missing regular episode and crosses the boundary',()=>{
 const watched=Array.from({length:10},(_,i)=>view('v'+i,1,i+1))
 assert.deepEqual(nextEpisode([],seasons),{season:1,episode:1})
 assert.deepEqual(nextEpisode(watched,seasons),{season:2,episode:1})
 assert.equal(nextEpisode([...watched,view('a',2,1),view('b',2,2)],seasons),null)
 assert.deepEqual(nextEpisode(watched.filter(v=>v.episode!==3),seasons),{season:1,episode:3})
 assert.deepEqual(nextEpisode([...watched,view('bad',1,126)],seasons),{season:2,episode:1})
})
test('unknown boundaries stop suggestions; specials and duplicate viewings do not advance them',()=>{
 assert.equal(nextEpisode([view('bad',1,125)]),null)
 assert.deepEqual(nextEpisode([view('special',0,99),view('first',1,1),view('again',1,1)],seasons),{season:1,episode:2})
 assert.equal(nextEpisode([],[{season:0,count:3}]),null)
 assert.deepEqual(nextEpisode([], [{season:3,count:1},{season:1,count:1}]),{season:1,episode:1})
})
test('season metadata rejects malformed and duplicate entries',()=>{
 for(const invalid of [null,{},[null],[{season:1,count:0}],[{season:-1,count:1}],[{season:1.5,count:1}],[{season:1,count:1},{season:1,count:2}],[{season:1,count:100000}]])assert.equal(validSeasons(invalid),false)
 assert.ok(validSeasons([]))
 assert.ok(validSeasons(seasons))
 assert.ok(validLibrary([title]))
 assert.ok(validLibrary([{...title,seasons:undefined,episodes:[view('legacy',1,125)]}]))
})
test('rewatch progress is isolated and clearing affects only selected immutable viewing IDs',()=>{
 const active=start(title,'2026-11-26')
 const records=[view('old',1,1),view('new',1,1,active.active.id),view('other',1,2,'other-run')]
 const current={...active,episodes:records}
 assert.deepEqual(episodeProgress(current),[records[1]])
 assert.deepEqual(nextEpisode(episodeProgress(current),seasons),{season:1,episode:2})
 const cleared=clearEpisodeViewings(current,['new','nonexistent'])
 assert.deepEqual(cleared.episodes,[records[0],records[2]])
 assert.equal(current.episodes.length,3)
 assert.equal(cleared.active,current.active)
 assert.equal(cleared.history,current.history)
})
test('bulk removals survive offline merge while concurrent new viewings survive',()=>{
 const initial=S.update(S.empty(),document([{...title,episodes:[view('a',1,1),view('b',1,126)]}]),'initial')
 const left=S.update(initial,document([clearEpisodeViewings(S.project(initial).library[0],['b'])]),'left')
 const right=S.update(initial,document([{...title,episodes:[view('a',1,1),view('b',1,126),view('c',1,2)]}]),'right')
 const merged=S.merge(left,right)
 assert.deepEqual(S.project(merged).library[0].episodes.map(v=>v.id),['a','c'])
 assert.deepEqual(S.project(S.merge(merged,initial)).library[0].episodes.map(v=>v.id),['a','c'])
 assert.deepEqual(S.project(merged).library[0].seasons,seasons)
 assert.ok(validLibrary(JSON.parse(JSON.stringify(S.project(merged).library))))
})
test('conflicting season changes remain reviewable and resolvable',()=>{
 const initial=S.update(S.empty(),document([title]),'initial')
 const a=S.update(initial,document([{...title,seasons:[{season:1,count:11}]}]),'a')
 const b=S.update(initial,document([{...title,seasons:[{season:1,count:12}]}]),'b')
 const merged=S.merge(a,b)
 const conflict=S.project(merged).conflicts.find(c=>c.parts[3]==='seasons')
 assert.equal(conflict.choices.length,2)
 const resolved=S.resolve(merged,conflict.key,0,'resolve')
 assert.equal(S.project(resolved).conflicts.length,0)
})
