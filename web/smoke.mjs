const origin=process.env.APP_ORIGIN
if(!/^https:\/\/quiet-screen\.[a-z0-9-]+\.workers\.dev$/.test(origin??''))throw Error('Use the actual deployed Quiet Screen workers.dev origin.')
let health
for(let attempt=0;attempt<30;attempt++){
 try{const response=await fetch(origin+'/_health');if(response.ok&&response.headers.get('Content-Type')?.includes('application/json')){health=await response.json();if(health.source===process.env.GITHUB_SHA)break}}catch{}
 await new Promise(resolve=>setTimeout(resolve,2000))
}
if(!health)throw Error('The deployed Worker did not become ready within one minute.')
if(health.service!=='Quiet Screen'||health.source!==process.env.GITHUB_SHA||!health.googleConfigured)throw Error('The live app does not match this configured source.')
for(const path of ['/','/app.mjs','/library.mjs','/sync/account.js','/web/drive-client.js','/style.css']){
 const response=await fetch(origin+path)
 if(!response.ok||!response.headers.get('Content-Security-Policy'))throw Error('Live shared asset check failed: '+path)
}
const denied=await fetch(origin+'/private/drive-session.bin')
if(denied.status!==404)throw Error('Unexpected private file route.')
console.log('PASS: live hosted source, configured Google adapter, shared assets and private-route denial.')
