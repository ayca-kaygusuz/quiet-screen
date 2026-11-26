import test from 'node:test'
import assert from 'node:assert/strict'
import {createReleaseCatalog,releaseResponse} from '../episode-releases.mjs'
import {releaseProgress,saveViewing,completeSeriesEpisodes,validReleaseInfo,validLibrary} from '../library.mjs'
import '../sync/sync-core.js'
const imdb='tt11737520', now=Date.parse('2026-11-26T12:00:00Z')
const episode=(season,number,date)=>({season,episode:number,name:'Episode '+number,airdate:date,airstamp:date?date+'T08:00:00Z':null})
const info={imdb,checkedAt:now,show:50241,episodes:[episode(1,1,'2023-08-31'),episode(2,1,'2026-03-10'),episode(3,1,'2027-01-01'),episode(3,2,null)]}
const base={id:'show',title:'One Piece',format:'TV series',year:'2023',imdb,episodic:true,active:null,history:[],episodes:[],seasons:[{season:1,count:1},{season:2,count:1},{season:3,count:2}],releases:info}

test('released, future, unknown dates and same-day times stay distinct',()=>{
 const progress=releaseProgress(base,now)
 assert.equal(progress.released.length,2)
 assert.equal(progress.upcoming.length,1)
 assert.equal(progress.unknown.length,1)
 const sameDay={...base,releases:{...info,episodes:[episode(1,1,'2026-11-26')]}}
 assert.equal(releaseProgress(sameDay,Date.parse('2026-11-26T07:59:00Z')).released.length,0)
 assert.equal(releaseProgress(sameDay,now).released.length,1)
})

test('series completion excludes future and unknown dates; a later season does not rewrite history',()=>{
 const watched=saveViewing(base,'past',{id:'first',started:null,finished:'2026-11-26'})
 assert.equal(watched.episodes.length,2)
 assert.equal(releaseProgress(watched,now).released.length,0)
 const updated=completeSeriesEpisodes({...watched,releases:{...info,episodes:[...info.episodes,episode(4,1,'2026-11-25')]},seasons:[...base.seasons,{season:4,count:1}]})
 assert.equal(updated.episodes.length,2)
 assert.equal(releaseProgress(updated,now).released.length,1)
 assert.ok(validLibrary([updated]))
 const S=globalThis.QuietScreenSync
 const synced=S.project(S.update(S.empty(),{library:[updated]},'test')).library[0]
 assert.deepEqual(synced.releases,updated.releases)
 assert.equal(completeSeriesEpisodes(synced).episodes.length,2)
})

test('historical completion uses its finish date and preserves no-date records',()=>{
 const past=saveViewing(base,'past',{id:'past',started:null,finished:'2024-01-01'})
 assert.equal(past.episodes.length,1)
 const undated=saveViewing(base,'past',{id:'undated',started:null,finished:null})
 assert.equal(undated.episodes.length,2)
 assert.ok(undated.episodes.every(e=>e.date===null))
})

test('release metadata rejects malformed, duplicate and invalid calendar dates',()=>{
 assert.ok(validReleaseInfo(info))
 for(const episodes of [[null],[episode(1,1,'2026-02-30')],[info.episodes[0],info.episodes[0]]])assert.equal(validReleaseInfo({...info,episodes}),false)
 assert.equal(releaseProgress({...base,releases:{...info,imdb:'tt0000001'}},now),null)
})

test('catalog uses exact IMDb match, shares requests, caches successes and remembers no-match',async()=>{
 const urls=[]
 const catalog=createReleaseCatalog({clock:()=>now,fetcher:async url=>{
  urls.push(url)
  if(url.includes('tt0000001'))return new Response(null,{status:404})
  return Response.json(url.includes('/lookup/')?{id:50241,externals:{imdb}}:[{season:1,number:1,name:'Pilot',airdate:'2023-08-31',airstamp:null}])
 }})
 const [a,b]=await Promise.all([catalog(imdb),catalog(imdb)])
 assert.deepEqual(a,b)
 assert.equal(a.episodes.length,1)
 await catalog(imdb)
 assert.equal(urls.length,2)
 assert.equal((await catalog('tt0000001')).show,null)
 assert.equal((await releaseResponse(new URL('https://app/api/episode-releases?id=bad'),catalog)).status,400)
})

test('wrong title and failed upstream never return fabricated release data',async()=>{
 const bad=createReleaseCatalog({fetcher:async()=>Response.json({id:1,externals:{imdb:'tt0000001'}})})
 await assert.rejects(bad(imdb),/mismatch/)
 const failed=createReleaseCatalog({fetcher:async()=>new Response(null,{status:429})})
 assert.equal((await releaseResponse(new URL('https://app/api/episode-releases?id='+imdb),failed)).status,502)
})
