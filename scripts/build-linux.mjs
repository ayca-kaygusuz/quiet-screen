import {createRequire} from 'node:module'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
if(process.platform!=='linux')throw Error('Build Linux packages on Linux or use the Linux workflow.')
execFileSync(process.execPath,['scripts/configure-desktop.mjs'],{stdio:'inherit'})
const require=createRequire(import.meta.url),{build,Platform,Arch}=require('electron-builder')
const version=JSON.parse(readFileSync('package.json','utf8')).version,output=resolve('work/linux')
await build({targets:Platform.LINUX.createTarget(['deb','tar.gz'],Arch.x64),publish:'never',config:{electronVersion:'45.2.3',directories:{output},...(process.env.QUIET_SCREEN_ELECTRON_DIST?{electronDist:resolve(process.env.QUIET_SCREEN_ELECTRON_DIST)}:{})}})
const files=[`Quiet-Screen-${version}-linux-amd64.deb`,`Quiet-Screen-${version}-linux-x64.tar.gz`]
const sums=files.map(name=>createHash('sha256').update(readFileSync(join(output,name))).digest('hex')+'  '+name)
writeFileSync(join(output,'SHA256SUMS-Linux.txt'),sums.join('\n')+'\n')
writeFileSync(join(output,'linux-build.json'),JSON.stringify({version,sourceSha:process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files}))
