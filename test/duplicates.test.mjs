import test from 'node:test'
import assert from 'node:assert/strict'
import {undoDuplicateAddition, completeSeriesEpisodes, duplicateAddition, status} from '../library.mjs'

const title = () => ({id:'lucifer',title:'Lucifer',imdb:'tt4052886',format:'TV series',year:'2016',group:{mode:'none',name:''},active:null,history:[],episodes:[],seasons:[]})

test('duplicate watchlist addition starts existing title and preserves its metadata', () => {
  const before=title(), after=duplicateAddition(before,'Watching').title
  assert.equal(status(after),'Watching')
  assert.equal(after.id,before.id)
  assert.equal(after.group,before.group)
  assert.equal(after.history,before.history)
  assert.equal(before.active,null)
  assert.match(after.active.started,/^\d{4}-\d{2}-\d{2}$/)
  assert.equal(duplicateAddition(after,'Watching').title,after)
})

test('watched duplicates require an explicit rewatch and retain undated history', () => {
  const before={...title(),history:[{id:'old',started:null,finished:null}]}
  assert.deepEqual(duplicateAddition(before,'Watching'),{title:before,offerRewatch:true})
  const after=duplicateAddition(before,'Watching',null,true).title
  assert.equal(status(after),'Rewatching')
  assert.equal(after.history,before.history)
  assert.equal(duplicateAddition(after,'Watching').title,after)
  assert.equal(duplicateAddition(before,'Watched').title,before)
})

test('duplicate completion finishes the existing run and completes known episodes', () => {
  const before={...title(),episodic:true,seasons:[{season:1,count:2}],active:{id:'run1',started:'2026-11-01'}}
  const after=duplicateAddition(before,'Watched','2026-11-26').title
  assert.equal(status(after),'Watched')
  assert.equal(after.history.length,1)
  assert.equal(after.history[0].run,'run1')
  assert.equal(after.history[0].started,'2026-11-01')
  assert.equal(after.episodes.length,2)
  const undated=duplicateAddition(title(),'Watched').title
  assert.equal(undated.history[0].finished,null)
})

test('watchlist duplicate never clears active viewing or completed history', () => {
  for(const before of [title(),{...title(),active:{id:'run1',started:null}},{...title(),history:[{id:'old',started:null,finished:null}]}]) {
    assert.equal(duplicateAddition(before,'Watchlist').title,before)
  }
})

test('Undo removes delayed inferred completion episodes while retaining refreshed metadata',()=>{
  const before={...title(),episodic:true}
  const saved=duplicateAddition(before,'Watched').title
  const current=completeSeriesEpisodes({...saved,poster:'https://m.media-amazon.com/images/M/test.jpg',seasons:[{season:1,count:2}]})
  assert.equal(current.episodes.length,2)
  const restored=undoDuplicateAddition(before,saved,current)
  assert.equal(restored.history.length,0)
  assert.equal(restored.episodes.length,0)
  assert.equal(restored.poster,current.poster)
  assert.deepEqual(restored.seasons,current.seasons)
  assert.equal(undoDuplicateAddition(before,saved,{...current,episodes:[...current.episodes,{id:'manual',season:1,episode:1,date:null,name:''}]}),null)
})
