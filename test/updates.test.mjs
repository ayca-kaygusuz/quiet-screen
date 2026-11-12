import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {latestUpdate,newerVersion,downloadUpdate,createUpdateController} from '../desktop/updates.mjs';

await mkdir('work',{recursive:true});const root=await mkdtemp(join('work','update-test-'));
const bytes=Buffer.from('MZ synthetic installer for tests'),sha=createHash('sha256').update(bytes).digest('hex');
const url='https://github.com/ayca-kaygusuz/quiet-screen/releases/download/v0.11.0/';
const filename='Quiet-Screen-Setup-0.11.0-x64.exe';
const release={tag_name:'v0.11.0',draft:false,prerelease:false,assets:[{name:filename,size:bytes.length,digest:'sha256:'+sha,browser_download_url:url+filename},{name:'SHA256SUMS.txt',browser_download_url:url+'SHA256SUMS.txt'}]};
let calls=[],badBytes=false,badRedirect=false;
async function fetcher(value,options){
 calls.push({url:value,options});assert.equal(options.redirect,'manual');const headers=new Headers(options.headers);
 for(const name of ['Authorization','Cookie','X-Google-Api-Key','X-Goog-Api-Key'])assert.equal(headers.get(name),null);
 if(value.startsWith('https://api.github.com/'))return Response.json(release);
 if(value.endsWith('SHA256SUMS.txt'))return new Response(sha+'  '+filename+'\r\n');
 if(badRedirect)return new Response('',{status:302,headers:{Location:'https://evil.com/installer.exe'}});
 return new Response(badBytes?Buffer.from('MZ damaged installer'):bytes);
}
try{
 assert(newerVersion('v0.11.0','0.10.9'));assert(newerVersion('0.10.11','0.10.9'));
 for(const [a,b] of [['0.10.1','0.10.1'],['0.9.9','0.10.0'],['v0.12.0-beta.1','0.11.0'],['../0.11.0','0.10.0']])assert.equal(newerVersion(a,b),false);
 let update=await latestUpdate('0.10.1',{fetcher});assert.equal(update.sha256,sha);assert.equal(update.version,'0.11.0');
 assert.equal(await latestUpdate('0.11.0',{fetcher}),null);
 for(const mutation of [{prerelease:true},{draft:true},{tag_name:'v0.12.0-beta.1'}])assert.equal(await latestUpdate('0.10.1',{fetcher:async()=>Response.json({...release,...mutation})}),null);
 for(const assets of [[],release.assets.map(a=>({...a,browser_download_url:'https://evil.com/'+a.name})),release.assets.map(a=>({...a,digest:a.digest?'sha256:'+'0'.repeat(64):undefined}))])await assert.rejects(()=>latestUpdate('0.10.1',{fetcher:async(u,o)=>u.startsWith('https://api.github.com/')?Response.json({...release,assets}):fetcher(u,o)}));

 let progress=[],path=await downloadUpdate(update,join(root,'cache'),{fetcher,onProgress:n=>progress.push(n)});
 assert.deepEqual(await readFile(path),bytes);assert.equal(progress.at(-1),1);
 const count=calls.length;assert.equal(await downloadUpdate(update,join(root,'cache'),{fetcher}),path);assert.equal(calls.length,count,'verified cached installer is reused');
 await writeFile(path,'Tampered cached file');badBytes=true;
 await assert.rejects(()=>downloadUpdate(update,join(root,'cache'),{fetcher}));
 assert(!(await readdir(join(root,'cache','0.11.0'))).some(name=>name.endsWith('.partial')));
 badBytes=false;await downloadUpdate(update,join(root,'cache'),{fetcher});assert.deepEqual(await readFile(path),bytes);
 badRedirect=true;await assert.rejects(()=>downloadUpdate(update,join(root,'redirect'),{fetcher}),/Untrusted/);badRedirect=false;
 await assert.rejects(()=>downloadUpdate({...update,filename:'../library.json'},root,{fetcher}));
 await assert.rejects(()=>downloadUpdate({...update,version:'../private'},root,{fetcher}));
 await assert.rejects(()=>downloadUpdate({...update,size:301*1024*1024},root,{fetcher}));
 let controllerRoot=join(root,'profile');await mkdir(controllerRoot);const sentinel=join(controllerRoot,'library-and-key.txt');await writeFile(sentinel,'existing personal data');
 let prompts=[],spawned=[],quits=0,answers=[0,0],opened=[];
 const options={app:{getPath:name=>{assert.equal(name,'userData');return controllerRoot},getVersion:()=>'0.10.1',quit:()=>quits++},getWindow:()=>({setProgressBar(){}}),dialog:{showMessageBox:async(_window,options)=>{prompts.push(options);return {response:answers.shift()??1}}},shell:{openExternal:async u=>opened.push(u)},fetcher,clock:()=>2000000000000,spawnInstaller:(file,args,opts)=>{spawned.push({file,args,opts});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child}};
 let controller=createUpdateController(options);const first=controller.check({manual:true});assert.equal(controller.check({manual:true}),first,'overlapping requests share one update flow');await first;
 assert.equal(controller.getStatus().phase,'available');assert.equal(prompts.length,0,'finding an update stays inline, even for manual checks');assert.equal(spawned.length,0);
 await controller.download();assert.equal(controller.getStatus().phase,'ready');assert.equal(prompts.length,0,'downloading does not interrupt with a restart prompt');await controller.install();
 assert.equal(prompts.length,1);assert.equal(spawned.length,1);assert.equal(quits,1);assert(spawned[0].args.includes('/RESTARTAPP'));assert(spawned[0].args.some(a=>a.startsWith('/UPDATEPID=')));assert.equal(spawned[0].opts.detached,true);
 assert.equal(await readFile(sentinel,'utf8'),'existing personal data');
 const after=calls.length;await controller.check();assert.equal(calls.length,after,'automatic checks are limited to daily');controller.dispose();
 let online=true,metered=true;prompts=[];
 const paused=createUpdateController({...options,app:{...options.app,getPath:()=>join(root,'paused')},network:async()=>({online,metered})});
 let before=calls.length;await paused.check();assert.equal(calls.length,before);assert.equal(paused.getStatus().pausedReason,'metered');
 await paused.check({manual:true});assert.equal(paused.getStatus().phase,'available');assert.equal(prompts.length,0);assert.equal(spawned.length,1,'metadata checks never download or install');
 await paused.configure({autoCheck:false});assert.equal(paused.getStatus().pausedReason,'disabled');before=calls.length;await paused.check();assert.equal(calls.length,before);paused.dispose();
 const remembered=createUpdateController({...options,app:{...options.app,getPath:()=>join(root,'paused')},network:async()=>({online,metered})});await remembered.ready;assert.equal(remembered.getStatus().autoCheck,false);assert.equal(remembered.getStatus().phase,'available','last-known availability survives restart');
 await remembered.configure({autoCheck:true});online=false;await remembered.check({manual:true});assert.equal(remembered.getStatus().pausedReason,'offline');remembered.dispose();
 let startedCheck;const beganCheck=new Promise(resolve=>startedCheck=resolve);
 const interrupted=createUpdateController({...options,app:{...options.app,getPath:()=>join(root,'interrupted')},fetcher:async(_url,{signal})=>{startedCheck();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true}))}});
 const checking=interrupted.check();await beganCheck;await interrupted.configure({autoCheck:false});await checking;assert.equal(interrupted.getStatus().pausedReason,'disabled');assert.notEqual(interrupted.getStatus().phase,'error','stopping an automatic check is not reported as a failure');assert.equal(interrupted.getStatus().lastChecked,0);interrupted.dispose();
 const offline=createUpdateController({...options,app:{...options.app,getPath:()=>join(root,'offline')},fetcher:async()=>{throw Error('Offline')}});
 await offline.check();assert.equal(prompts.length,0,'unreachable update service stays quiet');assert.equal(offline.getStatus().phase,'error');await offline.check({manual:true});assert.equal(prompts.length,0);assert.equal(spawned.length,1);assert.equal(offline.getStatus().lastChecked,0);offline.dispose();
 prompts=[];badBytes=true;
 const damaged=createUpdateController({...options,app:{...options.app,getPath:()=>join(root,'damaged')}});await damaged.check({manual:true});await damaged.download();assert.equal(damaged.getStatus().phase,'error');assert.equal(spawned.length,1,'unverified installers never execute');assert.equal(quits,1);assert.equal(prompts.length,0);damaged.dispose();
}finally{await rm(root,{recursive:true,force:true})}
