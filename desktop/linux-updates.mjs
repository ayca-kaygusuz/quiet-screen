import {mkdir,rename,readFile,rm} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {latestUpdate,releaseGet} from '../releases.mjs'
export function createLinuxUpdates({app,shell,network=async()=>({})}){
 let status={phase:'idle'},available,downloaded,busy=false,autoCheck=true,lastChecked=0,online=true,metered=false
 const snapshot=()=>({...status,currentVersion:app.getVersion(),enabled:app.isPackaged,platform:'linux',installMode:'manual',lastChecked})
 async function check(manual=false){if(busy||!online||!manual&&(!autoCheck||metered||Date.now()-lastChecked<86400000))return snapshot();busy=true;status={phase:'checking'}
  try{available=await latestUpdate(app.getVersion(),{kind:'linux'});lastChecked=Date.now();status={phase:available?'available':'up-to-date',version:available?.version??''}}catch{status={phase:'error'}}finally{busy=false}return snapshot()}
 async function handle(request){const url=new URL(request.url)
  if(url.pathname==='/api/update-status'&&request.method==='GET')return Response.json(snapshot())
  if(request.method!=='POST'||request.headers.get('X-Quiet-Screen-Update')!=='1')return new Response('Invalid update request',{status:403})
  const action=url.searchParams.get('action')
  if(action==='configure'){const data=await request.json();autoCheck=data.autoCheck!==false;online=data.online!==false;metered=data.metered===true;return Response.json(snapshot())}
  if(action==='check')return Response.json(await check(true))
  if(action==='install'&&downloaded){shell.showItemInFolder(downloaded);return Response.json(snapshot())}
  if(action!=='download'||busy||!available)return new Response('No package is ready',{status:409})
  busy=true;status={phase:'downloading',version:available.version,progress:0,downloaded:0,total:available.size}
  void(async()=>{const folder=join(app.getPath('userData'),'updates'),target=join(folder,available.filename),temporary=target+'.partial';try{
   await mkdir(folder,{recursive:true});const response=await releaseGet(available.url,fetch,undefined,true),reader=response.body.getReader(),output=createWriteStream(temporary,{flags:'w',mode:0o600}),hash=createHash('sha256');let size=0
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>available.size)throw Error('Package too large');hash.update(value);if(!output.write(value))await new Promise((resolve,reject)=>{output.once('drain',resolve);output.once('error',reject)});status={...status,downloaded:size,progress:size/available.size}}
    await new Promise((resolve,reject)=>{output.once('error',reject);output.end(resolve)})
   }finally{await reader.cancel().catch(()=>{});output.destroy()}
   if(size!==available.size||hash.digest('hex')!==available.sha256||(await readFile(temporary)).subarray(0,8).toString()!=='!<arch>\n')throw Error('Package verification failed')
   await rename(temporary,target);downloaded=target;status={...status,phase:'ready',progress:1}
  }catch{await rm(temporary,{force:true});status={phase:'error'}}finally{busy=false}})()
  return Response.json(snapshot())
 }
 return {check,handle,dispose(){}}
}
