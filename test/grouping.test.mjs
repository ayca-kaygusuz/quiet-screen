import assert from 'node:assert/strict'
import {test} from 'node:test'
import {seriesGroups} from '../library.mjs'
const title=(id,name,group)=>({id,title:name,group})
test('Steven Universe and its sequel series and movie group together',()=>{
 const library=[title('original','Steven Universe'),title('future','Steven Universe Future'),title('movie','Steven Universe: The Movie')]
 const groups=seriesGroups(library)
 assert.deepEqual(groups.get('original').members,['original','future','movie'])
 assert.equal(groups.get('future').name,'Steven Universe')
 assert.equal(groups.get('movie').key,'steven universe')
 assert.equal(seriesGroups([...library].reverse()).get('future').key,'steven universe')
})
test('word boundaries, generic titles and unrelated shared words remain standalone',()=>{
 const library=[title('a','The Office'),title('b','The Office Party'),title('c','Steven Universe'),title('d','Steven Universes'),
 title('e','Future'),title('f','Future Man'),title('g','How I Met Your Mother'),title('h','How I Met Your Father')]
 const groups=seriesGroups(library)
 for(const item of library)assert.equal(groups.has(item.id),false,item.title)
})
test('manual group overrides and standalone exclusions take precedence',()=>{
 const groups=seriesGroups([
 title('base','Steven Universe'),
 title('future','Steven Universe Future',{mode:'none',name:''}),
 title('movie','Steven Universe: The Movie',{mode:'manual',name:'Movie night'}),
 ])
 assert.equal(groups.has('base'),false)
 assert.equal(groups.has('future'),false)
 assert.equal(groups.get('movie').name,'Movie night')
})
test('sequel qualifiers require their base, support normalized names and matching manual groups',()=>{
 assert.equal(seriesGroups([title('future','Steven Universe Future')]).size,0)
 const groups=seriesGroups([title('base','  STEVEN   UNIVERSE  '),title('future','Steven Universe Future'),
 title('spin','Other title',{mode:'manual',name:'Steven Universe'})])
 assert.deepEqual(groups.get('base').members,['base','future','spin'])
})
test('existing numbered titles, seasons and subtitles retain their groups',()=>{
 const groups=seriesGroups([title('a','Example Story'),title('b','Example Story 2'),title('c','Example Story: Another Story'),
 title('d','Example Story Season 3')])
 assert.deepEqual(groups.get('a').members,['a','b','c','d'])
})
test('nested sequel names resolve to one franchise',()=>{
 const groups=seriesGroups([title('a','Example Story'),title('b','Example Story Origins'),title('c','Example Story Origins Future')])
 assert.deepEqual(groups.get('a').members,['a','b','c'])
})
