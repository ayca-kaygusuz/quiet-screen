import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {NtExecutable,NtExecutableResource,Resource,Data} from 'resedit'
import {setExecutableIcon} from '../desktop/icon.mjs'
test('Windows icon has every target size and embeds in an executable resource',async()=>{
 const icon=await readFile('desktop/assets/icon.ico')
 const file=Data.IconFile.from(icon)
 assert.deepEqual(file.icons.map(item=>item.width||256),[16,24,32,48,64,128,256])
 await mkdir('work',{recursive:true})
 const folder=await mkdtemp(join('work','icon-test-'))
 // Use a synthetic PE image, so the test runs on all build hosts.
 const exe=NtExecutable.createEmpty(false,false)
 const target=join(folder,'test.exe')
 const {writeFile}=await import('node:fs/promises')
 await writeFile(target,Buffer.from(exe.generate()))
 await setExecutableIcon(target,'desktop/assets/icon.ico')
 const resources=NtExecutableResource.from(NtExecutable.from(await readFile(target)))
 const groups=Resource.IconGroupEntry.fromEntries(resources.entries)
 assert.ok(groups.some(group=>group.id===1))
 const images=groups.find(group=>group.id===1).getIconItemsFromEntries(resources.entries)
 assert.equal(images.length,7)
})
