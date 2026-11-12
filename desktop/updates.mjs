import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';

import {RELEASES_URL,latestUpdate,releaseVersionParts as versionParts,releaseSafeDownload as safeDownload,releaseGet as get,newerVersion,updateFilename} from '../releases.mjs';
export {RELEASES_URL,latestUpdate,newerVersion} from '../releases.mjs';
const maxInstaller=300*1024*1024;
const packageHeader=bytes=>bytes.subarray(0,2).toString()==='MZ';
async function validFile(path,update){try{let hash=createHash('sha256'),size=0,header=Buffer.alloc(0);for await(let chunk of createReadStream(path)){size+=chunk.length;if(size>update.size)return false;if(header.length<8)header=Buffer.concat([header,chunk]).subarray(0,8);hash.update(chunk)}return size===update.size&&packageHeader(header)&&hash.digest('hex')===update.sha256}catch{return false}}
export async function downloadUpdate(update,directory,{fetcher=fetch,signal,onProgress=()=>{},onVerifying=()=>{}}={}){
  if(!versionParts(update.version)||update.filename!==updateFilename(update.version)||!safeDownload(update.url)||!/^[a-f0-9]{64}$/.test(update.sha256)||!Number.isSafeInteger(update.size)||update.size<2||update.size>maxInstaller)throw Error('Invalid update');
  let folder=join(directory,update.version),destination=join(folder,update.filename),partial=destination+'.partial';
  await mkdir(folder,{recursive:true,mode:0o700});
  if(await validFile(destination,update)){onVerifying();return destination}
  await rm(partial,{force:true});
  try{
    let response=await get(update.url,fetcher,signal,true),downloaded=0;
    await pipeline(Readable.fromWeb(response.body),async function*(source){for await(let chunk of source){downloaded+=chunk.length;if(downloaded>update.size)throw Error('Installer size mismatch');onProgress(downloaded/update.size,{downloaded,total:update.size});yield chunk}},createWriteStream(partial,{flags:'wx',mode:0o600}));
    onVerifying();
    if(!await validFile(partial,update))throw Error('Installer verification failed');
    await rm(destination,{force:true});await rename(partial,destination);return destination;
  }finally{await rm(partial,{force:true})}
}

export function createUpdateController({app,dialog,getWindow,fetcher=fetch,spawnInstaller=spawn,clock=Date.now,enabled=true,network=async()=>({online:true,metered:false})}){
 const folder=join(app.getPath('userData'),'updates'),stateFile=join(folder,'check.json'),abort=new AbortController();
 let running=null,pendingInstall=null,available=null,lastChecked=0,lastAttempt=0,autoCheck=true,reportedNetwork={online:true,metered:false},observedNetwork={},saveQueue=Promise.resolve(),activeAutomaticCheck=null;
 let status={phase:'idle',version:'',progress:null,downloaded:0,total:0,visible:false};
 const ready=(async()=>{try{const saved=JSON.parse(await readFile(stateFile,'utf8'));if(typeof saved.autoCheck==='boolean')autoCheck=saved.autoCheck;if(Number.isFinite(saved.checkedAt)&&saved.checkedAt>0)lastChecked=saved.checkedAt;const u=saved.available;if(u&&newerVersion(u.version,app.getVersion())&&u.filename===updateFilename(u.version)&&u.url==='https://github.com/ayca-kaygusuz/quiet-screen/releases/download/v'+u.version+'/'+u.filename&&Number.isSafeInteger(u.size)&&u.size>=2&&u.size<=300*1024*1024&&/^[a-f0-9]{64}$/.test(u.sha256)){available=u;status={...status,phase:'available',version:u.version,total:u.size}}else if(u&&newerVersion(u.version,app.getVersion()))lastChecked=0;else if(lastChecked)status={...status,phase:'up-to-date'}}catch{}})();
 const paused=()=>!autoCheck?'disabled':observedNetwork.online===false||reportedNetwork.online===false?'offline':observedNetwork.metered===true||reportedNetwork.metered===true?'metered':null;
 const snapshot=()=>({...status,currentVersion:app.getVersion(),enabled,autoCheck,lastChecked,pausedReason:paused(),platform:'windows',installMode:'restart'});
 function report(phase,values={}){status={phase,version:'',progress:null,downloaded:0,total:0,visible:false,...values}}
 function persist(){const data=JSON.stringify({checkedAt:lastChecked,autoCheck,available});saveQueue=saveQueue.catch(()=>{}).then(async()=>{await mkdir(folder,{recursive:true,mode:0o700});await writeFile(stateFile+'.tmp',data,{mode:0o600});await rename(stateFile+'.tmp',stateFile)});return saveQueue}
 async function inspectNetwork(){try{observedNetwork=await network()}catch{observedNetwork={}}}
 async function confirmInstall(){
  if(!pendingInstall||status.phase!=='ready')return;
  const window=getWindow();if(!window)return;
  const answer=await dialog.showMessageBox(window,{title:'Quiet Screen updates',message:'Your update is ready.',detail:'Restart Quiet Screen to install it. Finish any unsaved title entry first.',buttons:['Restart and update','Later'],defaultId:0,cancelId:1});
  if(answer.response!==0)return;
  const {installer,update}=pendingInstall;
  if(!await validFile(installer,update))throw Error('Installer verification failed');
  report('installing',{version:update.version,progress:1,downloaded:update.size,total:update.size,visible:true});
  const child=spawnInstaller(installer,['/S',`/UPDATEPID=${process.pid}`,'/RESTARTAPP'],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve)});child.unref();app.quit();
 }
 function failed(){getWindow()?.setProgressBar(-1);if(!abort.signal.aborted)report('error',{visible:false})}
 async function run(manual){
  await ready;await inspectNetwork();
  if(observedNetwork.online===false||reportedNetwork.online===false||!manual&&paused())return;
  if(pendingInstall&&status.phase!=='error')return;if(status.phase==='error')pendingInstall=null;
  if(!manual&&(lastChecked>0&&clock()>=lastChecked&&clock()-lastChecked<86400000||lastAttempt>0&&clock()>=lastAttempt&&clock()-lastAttempt<300000))return;
  lastAttempt=clock();const before=status,requestAbort=new AbortController();if(!manual)activeAutomaticCheck=requestAbort;report('checking');
  try{const found=await latestUpdate(app.getVersion(),{fetcher,signal:AbortSignal.any([abort.signal,requestAbort.signal])});if(requestAbort.signal.aborted){status=before;lastAttempt=0;return}available=found;lastChecked=clock();await persist();report(available?'available':'up-to-date',available?{version:available.version,total:available.size}:{})}catch(error){if(requestAbort.signal.aborted){status=before;lastAttempt=0}else if(error.code==='RELEASE_UNAVAILABLE'){available=null;lastChecked=clock();report('unavailable')}else failed()}finally{if(activeAutomaticCheck===requestAbort)activeAutomaticCheck=null}
 }
 async function download(){
  await ready;await inspectNetwork();if(observedNetwork.online===false||reportedNetwork.online===false)return;
  if(pendingInstall){report('ready',{version:pendingInstall.update.version,progress:1,downloaded:pendingInstall.update.size,total:pendingInstall.update.size,visible:true});return}
  if(!available)await run(true);if(!available||abort.signal.aborted)return;
  const update=available;report('downloading',{version:update.version,progress:0,total:update.size,visible:true});
  try{
   const installer=await downloadUpdate(update,folder,{fetcher,signal:abort.signal,onProgress:(progress,bytes)=>{report('downloading',{version:update.version,progress,...bytes,visible:true});getWindow()?.setProgressBar(progress)},onVerifying:()=>report('verifying',{version:update.version,progress:1,downloaded:update.size,total:update.size,visible:true})});
   getWindow()?.setProgressBar(-1);pendingInstall={installer,update};report('ready',{version:update.version,progress:1,downloaded:update.size,total:update.size,visible:true});
  }catch{failed()}
 }
 function enqueue(work){if(!running)running=work().finally(()=>{running=null});return running}
 return {ready,getStatus:snapshot,async configure({autoCheck:next,online,metered}){await ready;if(typeof next!=='boolean')throw Error('Invalid update preference');const wasPaused=paused();if(typeof online==='boolean')reportedNetwork.online=online;if(typeof metered==='boolean')reportedNetwork.metered=metered;if(autoCheck!==next){autoCheck=next;if(paused())activeAutomaticCheck?.abort();await persist()}await inspectNetwork();if(paused())activeAutomaticCheck?.abort();else if(wasPaused&&enabled)void enqueue(()=>run(false));return snapshot()},check({manual=false}={}){return enabled?enqueue(()=>run(manual)):Promise.resolve()},download(){return enabled?enqueue(download):Promise.resolve()},install(){return enabled?enqueue(()=>confirmInstall().catch(failed)):Promise.resolve()},dispose(){abort.abort()}};
}
