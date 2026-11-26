import test from 'node:test'
import assert from 'node:assert/strict'
import {createLinuxUpdates} from '../desktop/linux-updates.mjs'
test('Linux updates implement the shared desktop controller contract and honor automatic-check preferences',async()=>{
 const updates=createLinuxUpdates({app:{isPackaged:true,getVersion:()=> '0.8.0'},shell:{showItemInFolder(){throw Error('Unexpected install')}}})
 for(const name of ['getStatus','configure','check','download','install','dispose'])assert.equal(typeof updates[name],'function',name)
 assert.equal(updates.getStatus().enabled,true)
 assert.equal(updates.getStatus().installMode,'manual')
 await updates.configure({autoCheck:false,online:true,metered:false})
 assert.equal((await updates.check()).phase,'idle')
 await updates.configure({autoCheck:true,online:false,metered:false})
 assert.equal((await updates.check({manual:true})).phase,'idle')
 await assert.rejects(updates.install(),/unavailable/)
 updates.dispose()
})
