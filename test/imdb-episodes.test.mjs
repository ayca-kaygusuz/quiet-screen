import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {createImdbEpisodeCatalog,indexEpisodeRows,episodeResponse,EPISODE_DATASET} from '../imdb-episodes.mjs'
const header='tconst\tparentTconst\tseasonNumber\tepisodeNumber'
const rows=[header,'tt1000001\ttt0944947\t1\t1','tt1000002\ttt0944947\t1\t10','tt1000003\ttt0944947\t2\t1',
 'tt1000004\ttt0944947\t2\t1','tt1000005\ttt0944947\t\\N\t4','tt1000006\ttt0944947\t2\t\\N',
 'tt1000007\ttt0944947\t0\t1','tt1000008\ttt11280740\t1\t9']
async function directory(){await mkdir('work',{recursive:true});return mkdtemp(join('work','imdb-test-'))}
test('IMDb rows map parent IDs, season boundaries, specials and duplicate rows correctly',async()=>{
 const result=await indexEpisodeRows(rows)
 assert.deepEqual(result.tt0944947,[{season:0,count:1},{season:1,count:10},{season:2,count:1}])
 assert.deepEqual(result.tt11280740,[{season:1,count:9}])
 await assert.rejects(indexEpisodeRows(['wrong header']),/format changed/)
})
test('concurrent title lookups share a download and cache survives restart',async()=>{
 const folder=await directory()
 let downloads=0
 const provider=async url=>{assert.equal(url,EPISODE_DATASET);downloads++;return new Response(gzipSync(rows.join('\n')))}
 const lookup=createImdbEpisodeCatalog({directory:folder,fetcher:provider})
 const [a,b]=await Promise.all([lookup('tt0944947'),lookup('tt11280740')])
 assert.equal(downloads,1)
 assert.equal(a.seasons.length,3)
 assert.equal(b.seasons[0].count,9)
 const restarted=createImdbEpisodeCatalog({directory:folder,fetcher:()=>assert.fail('Fresh cache must work offline')})
 assert.deepEqual(await restarted('tt0944947'),a)
 assert.deepEqual((await restarted('tt9999999')).seasons,[])
 await assert.rejects(lookup('../../private'),/Invalid/)
})
test('expired caches refresh and failed downloads do not replace a saved cache',async()=>{
 const folder=await directory()
 let now=1
 const lookup=createImdbEpisodeCatalog({directory:folder,clock:()=>now,fetcher:async()=>new Response(gzipSync(rows.join('\n')))})
 await lookup('tt0944947')
 const original=await readFile(join(folder,'episodes-v1.json'),'utf8')
 now+=8*86400000
 const failed=createImdbEpisodeCatalog({directory:folder,clock:()=>now,fetcher:async()=>new Response('denied',{status:403})})
 await assert.rejects(failed('tt0944947'),/download failed/)
 assert.equal(await readFile(join(folder,'episodes-v1.json'),'utf8'),original)
})
test('corrupt gzip and unavailable datasets fail safely; API validates title IDs',async()=>{
 const lookup=createImdbEpisodeCatalog({directory:await directory(),fetcher:async()=>new Response('not gzip')})
 await assert.rejects(lookup('tt0944947'))
 const invalid=await episodeResponse(new URL('http://localhost/api/imdb-episodes?id=invalid'),()=>assert.fail('Invalid ID'))
 assert.equal(invalid.status,400)
 const failure=await episodeResponse(new URL('http://localhost/api/imdb-episodes?id=tt0944947'),async()=>{throw Error('private file path')})
 assert.equal(failure.status,502)
 assert.ok(!(await failure.text()).includes('private file path'))
})
