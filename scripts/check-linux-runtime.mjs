import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
const profile=mkdtempSync(join(tmpdir(),'quiet-screen-linux-')),env={...process.env,XDG_CONFIG_HOME:profile},exe='/usr/bin/quiet-screen'
let child,socket,next=0;const pending=new Map()
async function command(method,params={}){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
async function start(){
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r))
 let startupLog=''
 child=spawn(exe,['--disable-gpu','--password-store=gnome-libsecret','--remote-debugging-port='+port],{env,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',data=>{startupLog+=data});child.stderr.on('data',data=>{startupLog+=data})
 let page
 for(let i=0;i<150;i++){try{page=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(p=>p.type==='page');if(page)break}catch{}await new Promise(r=>setTimeout(r,100))}
 if(!page)throw Error('The installed Linux app did not start with its sandbox enabled. Exit: '+child.exitCode+'\n'+startupLog)
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})})
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data),p=pending.get(data.id);if(p){clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result)}})
 for(let i=0;i<150;i++){if(await evaluate('!!globalThis.QuietScreenApp&&!!globalThis.QuietScreenAccount'))return;await new Promise(r=>setTimeout(r,100))}
 throw Error('The shared app did not load.')
}
async function stop(){if(socket){void command('Browser.close').catch(()=>{});socket.close()}if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGTERM');resolve()},5000)})}
try{
 await start()
 assert.equal(await evaluate('typeof require'),'undefined')
 const account=await evaluate("fetch('/api/account/status').then(r=>r.json())")
 assert.equal(account.platform,'linux');assert.equal(account.rememberSupported,true)
 assert.equal((await evaluate("fetch('/api/update-status').then(r=>r.json())")).installMode,'manual')
 await evaluate("QuietScreenApp.apply({library:[{id:'linux-test',title:'Linux runtime movie',format:'Movie',year:'',imdb:'',episodic:false,active:{id:'run',started:null,position:1234,notes:'Keep this across restart'},history:[],episodes:[],seasons:[]}],lists:[],preferences:{theme:'sage'}});QuietScreenApp.changed?.();true")
 await stop();await start()
 const restored=await evaluate('QuietScreenApp.snapshot()');assert.equal(restored.library[0].active.position,1234);assert.equal(restored.library[0].active.notes,'Keep this across restart');assert.equal(restored.preferences.theme,'sage')
 const runtime=join(process.env.QUIET_SCREEN_ELECTRON_DIST,'electron'),probe=join(profile,'keyring-probe')
 for(const mode of ['write','read']){const result=spawnSync(runtime,['--password-store=gnome-libsecret','scripts/check-linux-keyring.cjs'],{env:{...env,QUIET_SCREEN_KEYRING_PROBE:probe,QUIET_SCREEN_KEYRING_MODE:mode},encoding:'utf8',timeout:30000});if(result.status!==0)throw Error(result.stderr||result.stdout);console.log(result.stdout.trim())}
 console.log('PASS: installed Linux sandbox, shared UI, movie resume and notes persistence, manual updates and real keyring encryption.')
}finally{await stop()}
