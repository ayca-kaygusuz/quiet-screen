import assert from 'node:assert/strict'
import {test} from 'node:test'
import {franchiseChecked,franchiseTargets,franchiseSuggestions,setBundle,unbundle,validFranchiseCheck} from '../franchises.mjs'
import {lookupFranchises,franchiseResponse,FRANCHISE_ENDPOINT} from '../franchise-lookup.mjs'
import {validLibrary,seriesGroups} from '../library.mjs'
import '../sync/sync-core.js'
const S=globalThis.QuietScreenSync
const check=(imdb,entity,links=[])=>({imdb,entity,links,checkedAt:'2026-11-26T12:00:00.000Z'})
const title=(id,name,imdb,franchiseCheck)=>({id,title:name,imdb,format:'TV series',year:'',history:[],episodes:[],active:null,franchiseCheck})
const link=(id,label='Franchise',relation='P8345')=>({id,label,relation})
const library=[
 title('bb','Breaking Bad','tt0903747',check('tt0903747','Q1079',[link('Q113461786','Breaking Bad')])),
 title('saul','Better Call Saul','tt3032476',check('tt3032476','Q14925221',[link('Q113461786','Breaking Bad'),link('Q1079','Breaking Bad','P144')])),
 title('parks','Parks and Recreation','tt1266020',check('tt1266020','Q218035')),
]
test('actual relationship IDs connect differently named titles and leave standalones alone',()=>{
 const groups=franchiseSuggestions(library)
 assert.equal(groups.length,1)
 assert.deepEqual(groups[0].members,['bb','saul'])
 assert.equal(groups[0].name,'Breaking Bad')
 assert.ok(groups[0].evidence.some(item=>item.id==='Q113461786'))
})
test('unchecked filtering remembers grouped titles, standalones and unmatched titles',()=>{
 const missing=title('new','New','tt1000001')
 const unmatched=title('none','Missing source','tt1000002',check('tt1000002',null))
 assert.equal(franchiseChecked(unmatched),true)
 assert.deepEqual(franchiseTargets([...library,missing,unmatched]).map(item=>item.id),['new'])
 assert.equal(franchiseTargets([...library,missing,unmatched],true).length,5)
 assert.deepEqual(franchiseTargets([...library,missing],true,['parks']).map(item=>item.id),['parks'])
 assert.equal(franchiseChecked({...library[2],imdb:'tt1000003'}),false)
})
test('new unchecked titles can connect to previously checked standalones without requerying them',()=>{
 const original=title('one','Original','tt1000001',check('tt1000001','Q1'))
 const spin=title('two','Different title','tt1000002',check('tt1000002','Q2',[link('Q1','Original','P144')]))
 assert.deepEqual(franchiseSuggestions([original,spin])[0].members,['one','two'])
})
test('transitive relationships join one bundle, while shared labels with different IDs do not',()=>{
 const a=title('a','A','tt1000001',check('tt1000001','Q1',[link('Q2')]))
 const b=title('b','B','tt1000002',check('tt1000002','Q2',[link('Q3')]))
 const c=title('c','C','tt1000003',check('tt1000003','Q3'))
 const unrelated=title('d','D','tt1000004',check('tt1000004','Q4',[link('Q5')]))
 assert.deepEqual(franchiseSuggestions([a,b,c,unrelated])[0].members,['a','b','c'])
})
test('manual bundling and unbundling preserve history and checked status',()=>{
 const bundled=setBundle(library,['bb','saul'],'My franchise')
 assert.equal(seriesGroups(bundled).get('bb').name,'My franchise')
 const changed=setBundle(bundled,['bb','parks'],'My franchise',['bb','saul'])
 assert.equal(changed.find(item=>item.id==='saul').group.mode,'none')
 const separated=unbundle(changed,['bb','parks'])
 assert.equal(seriesGroups(separated).size,0)
 assert.ok(separated.every(franchiseChecked))
 assert.deepEqual(separated.map(item=>item.history),library.map(item=>item.history))
 assert.throws(()=>setBundle(library,['bb'],'   '))
})
test('checked data and negative results survive backup and offline sync',()=>{
 const initial=S.update(S.empty(),{library},'initial')
 const restored=S.project(initial).library
 assert.ok(validLibrary(JSON.parse(JSON.stringify(restored))))
 assert.ok(restored.every(franchiseChecked))
 assert.equal(franchiseTargets(restored).length,0)
 const left=S.update(initial,{library:unbundle(restored,['bb','saul'])},'left')
 const right=S.update(initial,{library:restored.map(item=>item.id==='parks'?{...item,title:'Parks & Recreation'}:item)},'right')
 const merged=S.project(S.merge(left,right)).library
 assert.ok(merged.every(franchiseChecked))
 assert.equal(merged.find(item=>item.id==='bb').group.mode,'none')
})
const row=(imdb,entity,relation,target,label)=>({
 imdb:{value:imdb},item:{value:'http://www.wikidata.org/entity/'+entity},
 ...(relation?{relation:{value:'http://www.wikidata.org/prop/direct/'+relation},target:{value:'http://www.wikidata.org/entity/'+target},label:{value:label}}:{})
})
test('lookup uses IMDb identifiers, accepts negative results and does not send credentials',async()=>{
 const results=await lookupFranchises(['tt0903747','tt1266020','tt1000001'],{
  fetcher:async(url,options)=>{
   assert.equal(new URL(url).origin,new URL(FRANCHISE_ENDPOINT).origin)
   const query=new URL(url).searchParams.get('query')
   assert.match(query,/wdt:P345/)
   assert.match(query,/tt1266020/)
   assert.ok(!query.includes('Parks'))
   assert.equal(new Headers(options.headers).get('Authorization'),null)
   assert.equal(new Headers(options.headers).get('Cookie'),null)
   return Response.json({results:{bindings:[row('tt0903747','Q1079','P8345','Q113461786','Breaking Bad'),row('tt1266020','Q218035')]}})
  },
 })
 assert.ok(results.every(validFranchiseCheck))
 assert.equal(results[0].links[0].label,'Breaking Bad')
 assert.equal(results[1].links.length,0)
 assert.equal(results[2].entity,null)
})
test('errors, malformed replies, ambiguous IDs and unrelated properties are not saved as negative checks',async()=>{
 await assert.rejects(lookupFranchises(['bad']))
 await assert.rejects(lookupFranchises(['tt0903747'],{fetcher:async()=>new Response('',{status:429})}),/busy/)
 for(const bindings of [
  [row('tt0903747','Q1'),row('tt0903747','Q2')],
  [row('tt0903747','Q1','P999','Q2','Reference')],
  [row('tt0903747','Q1','P8345','bad','Bad')],
 ]){
  await assert.rejects(lookupFranchises(['tt0903747'],{fetcher:async()=>Response.json({results:{bindings}})}))
 }
 await assert.rejects(lookupFranchises(['tt0903747'],{fetcher:async()=>Response.json({error:'unavailable'})}))
})
test('franchise endpoint enforces origin, method, body limit and custom header',async()=>{
 const url='http://127.0.0.1:4178/api/franchises'
 assert.equal((await franchiseResponse(new Request(url))).status,405)
 assert.equal((await franchiseResponse(new Request(url,{method:'POST',body:'{}'}))).status,403)
 const headers={'X-Quiet-Screen-Catalogue':'1',Origin:'https://other.example'}
 assert.equal((await franchiseResponse(new Request(url,{method:'POST',headers,body:'{}'}))).status,403)
 headers.Origin='http://127.0.0.1:4178'
 const response=await franchiseResponse(new Request(url,{method:'POST',headers,body:JSON.stringify({ids:['tt0903747']})}),{
  fetcher:async()=>Response.json({results:{bindings:[row('tt0903747','Q1079')]}}),
 })
 assert.equal(response.status,200)
 assert.equal((await response.json()).results[0].entity,'Q1079')
 assert.equal((await franchiseResponse(new Request(url,{method:'POST',headers,body:'x'.repeat(9000)}))).status,400)
})
test('separate bundles with identical display names retain distinct identities',()=>{
 const items=[...library,title('other','Other show','tt1000001')]
 let bundled=setBundle(items,['bb','saul'],'Same name',[],'bundle-one')
 bundled=setBundle(bundled,['parks','other'],'Same name',[],'bundle-two')
 const groups=seriesGroups(bundled)
 assert.notEqual(groups.get('bb').key,groups.get('parks').key)
 assert.deepEqual(groups.get('bb').members,['bb','saul'])
})
