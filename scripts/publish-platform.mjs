import {readFileSync,writeFileSync,readdirSync,mkdtempSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const [kind,folder]=process.argv.slice(2),repo='ayca-kaygusuz/quiet-screen'
const packageFolder=kind==='ios'&&existsSync(join(folder,'work','ios'))?join(folder,'work','ios'):folder
const version=JSON.parse(readFileSync('package.json','utf8')).version,tag='v'+version,sha=process.env.GITHUB_SHA
if(!['windows','linux','android','ios'].includes(kind)||!/^[a-f0-9]{40}$/.test(sha??'')||!folder)throw Error('Publish a tested platform build from an exact source commit.')
const headers={Authorization:'Bearer '+(process.env.GH_TOKEN??process.env.GITHUB_TOKEN),Accept:'application/vnd.github+json'}
const root='https://api.github.com/repos/'+repo
const api=async path=>{const response=await fetch(root+path,{headers});return response.ok?response.json():null}
let release=await api('/releases/tags/'+tag)
if(!release&&kind==='windows'){
 execFileSync('gh',['release','create',tag,'--repo',repo,'--target',sha,'--title','Quiet Screen '+tag,'--notes-file','RELEASE_NOTES.md'],{stdio:'inherit'})
 release=await api('/releases/tags/'+tag)
}
for(let i=0;!release&&i<60;i++){await new Promise(r=>setTimeout(r,10000));release=await api('/releases/tags/'+tag)}
if(!release)throw Error('Publish the matching Windows/browser release first.')
const ref=await api('/git/ref/tags/'+tag)
if(ref?.object?.sha!==sha)throw Error('The release tag does not match this tested source commit.')
const names=readdirSync(packageFolder).filter(name=>kind==='windows'?name.endsWith('.exe')||name==='quiet-screen-pc.zip':kind==='linux'?name.endsWith('.deb')||name.endsWith('.tar.gz'):kind==='android'?name.endsWith('.apk')&&!name.includes('unsigned')||/^desugar_jdk_libs-.*-source.zip$/.test(name)||name==='android-signing-certificate.txt':name.endsWith('-unsigned.ipa')||name==='INSTALL-iPhone-iPad.md')
if(!names.some(name=>kind==='windows'?name.endsWith('.exe'):kind==='linux'?name.endsWith('.deb'):kind==='android'?name.endsWith('.apk'):name.endsWith('.ipa')))throw Error('The tested platform package is missing.')
const checks=new Map()
const checksum=release.assets.find(a=>a.name==='SHA256SUMS.txt')
if(checksum){const response=await fetch(checksum.browser_download_url);if(!response.ok)throw Error('Could not read the existing release checksum manifest.');for(const line of (await response.text()).split(/\r?\n/)){const match=line.match(/^([a-f0-9]{64})\s+(.+)$/);if(match)checks.set(match[2],match[1])}}
for(const name of names){
 const path=join(packageFolder,name),bytes=readFileSync(path),hash=createHash('sha256').update(bytes).digest('hex'),existing=release.assets.find(a=>a.name===name)
 if(existing){if(existing.digest!=='sha256:'+hash&&checks.get(name)!==hash)throw Error('Refusing to replace an existing package: '+name)}
 else execFileSync('gh',['release','upload',tag,path,'--repo',repo],{stdio:'inherit'})
 checks.set(name,hash)
}
release=await api('/releases/tags/'+tag)
const targets=JSON.parse(readFileSync('platform-manifest.json','utf8')),packages=[]
for(const [platform,value] of Object.entries(targets.platforms))for(const artifact of [value.artifact,value.portableArtifact].filter(Boolean)){
 const name=artifact.replaceAll('{version}',version),asset=release.assets.find(a=>a.name===name)
 if(asset&&checks.has(name))packages.push({platform,packageId:value.packageId??null,filename:name,url:asset.browser_download_url,sha256:checks.get(name),size:asset.size,installMode:value.installMode})
}
const directory=mkdtempSync(join(tmpdir(),'quiet-screen-release-'))
writeFileSync(join(directory,'SHA256SUMS.txt'),[...checks].sort(([a],[b])=>a.localeCompare(b)).map(([name,hash])=>hash+'  '+name).join('\n')+'\n')
writeFileSync(join(directory,'quiet-screen-release.json'),JSON.stringify({schemaVersion:1,appId:targets.appId,version,sourceSha:sha,repository:repo,packages},null,2)+'\n')
execFileSync('gh',['release','upload',tag,join(directory,'SHA256SUMS.txt'),join(directory,'quiet-screen-release.json'),'--repo',repo,'--clobber'],{stdio:'inherit'})
console.log('Published immutable '+kind+' packages and merged release metadata.')
