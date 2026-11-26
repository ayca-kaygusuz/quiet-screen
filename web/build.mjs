import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {build} from 'esbuild'
import {sharedAssets} from '../scripts/platform-assets.mjs'
const assets={}
for(const name of [...sharedAssets,'web/drive-client.js','license.txt','NOTICE','THIRD_PARTY_NOTICES.md']){
 const path=name==='license.txt'?'LICENSE':name
 const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/plain; charset=utf-8'
 let body=readFileSync(path,'utf8')
 if(name==='index.html')body=body.replace('</head>','<script src="/web/build-info.js" defer></script><script type="module" src="/web/drive-client.js"></script></head>')
 assets['/'+name]={body,type}
}
mkdirSync('work/hosted',{recursive:true})
await build({stdin:{contents:`import {createHostedWorker} from './web/worker.mjs'; export default createHostedWorker({assets:${JSON.stringify(assets)}});`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'work/hosted/index.mjs',banner:{js:'/* QuietScreenHostedWorker schema=1 */'},logLevel:'silent'})
console.log('Hosted Worker built from shared source, without reading runtime credentials.')
