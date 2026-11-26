import {readFile,writeFile} from 'node:fs/promises'
import {NtExecutable,NtExecutableResource,Resource,Data} from 'resedit'
export async function setExecutableIcon(executable,icon) {
  const exe=NtExecutable.from(await readFile(executable))
  const resources=NtExecutableResource.from(exe)
  const icons=Data.IconFile.from(await readFile(icon))
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries,1,1033,icons.icons.map(item=>item.data))
  resources.outputResource(exe)
  await writeFile(executable,Buffer.from(exe.generate()))
}
