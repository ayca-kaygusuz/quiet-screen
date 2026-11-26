import {readFileSync,mkdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs'
import {join,dirname} from 'node:path'
export const sharedAssets=['index.html','style.css','app.mjs','library.mjs','franchises.mjs','franchise-lookup.mjs','episode-releases.mjs','catalogue.mjs','releases.mjs','update-ui.mjs','sync/account.js','sync/sync-core.js','sync/drive.mjs']
export const mobileAssets=[...sharedAssets,'mobile/bootstrap.js','mobile/native-api.mjs','mobile/mobile.css','license.txt','NOTICE','THIRD_PARTY_NOTICES.md','native-notices.txt']
export const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src https://m.media-amazon.com; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"
export function prepareMobile(root){
 const version=JSON.parse(readFileSync('package.json','utf8')).version
 for(const name of mobileAssets){
  const target=join(root,name);mkdirSync(dirname(target),{recursive:true})
  if(name==='native-notices.txt'){
   const notices=process.env.QUIET_SCREEN_IOS_NOTICES
   writeFileSync(target,notices?readFileSync(notices,'utf8'):['LICENSE','ASSEMBLY_EXCEPTION','ADDITIONAL_LICENSE_INFO'].map(n=>readFileSync('assets/licenses/desugar-jdk-'+n+'.txt','utf8')).join('\n\n'))
  }else if(name==='license.txt')copyFileSync('LICENSE',target)
  else if(name==='index.html')writeFileSync(target,readFileSync(name,'utf8').replace('</head>','<link rel="stylesheet" href="/mobile/mobile.css"><script src="/mobile/bootstrap.js"></script></head>'))
  else if(name==='releases.mjs')writeFileSync(target,readFileSync(name,'utf8').replace(/import manifest from .*?;\r?\n/,`const manifest={version:${JSON.stringify(version)}};\n`))
  else copyFileSync(name,target)
 }
 writeFileSync(join(root,'csp.txt'),csp)
}
