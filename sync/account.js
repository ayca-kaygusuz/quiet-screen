// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

(function(root){
 'use strict';
 const App=root.QuietScreenApp,S=root.QuietScreenSync;if(!App||!S)return;
 const $=selector=>document.querySelector(selector),actor=crypto.randomUUID();
 const guestStorage='quiet-screen-guest-v1',activeStorage='quiet-screen-active-account-v1',settingsStorage='quiet-screen-sync-settings-v1',recoveryStorage='quiet-screen-connection-recovery-v1';
 const workspaceKey=id=>'quiet-screen-account-'+id+'-v1',pendingKey=id=>'quiet-screen-connection-'+id+'-v1';
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},store=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
 const realBooks=doc=>doc?.library||[],validated=doc=>App.validateDocument(doc);
 const publicAccount=value=>value&&typeof value.id==='string'&&/^\d{1,100}$/.test(value.id)&&typeof value.email==='string'?{id:value.id,email:value.email,name:typeof value.name==='string'?value.name:value.email}:null;
 let settings={auto:true,meteredOverride:null,...read(settingsStorage,{})};if(typeof settings.auto!=='boolean')settings.auto=true;if(typeof settings.meteredOverride!=='boolean')settings.meteredOverride=null;
 let account=null,linked=false,state=S.empty(),dirty=false,lastSync=null,firstPull=false,sourceAccountId=null,preview=null;
 let connection={configured:false,mode:location.protocol==='quiet-screen:'?'desktop':'local',network:{}},applying=false,syncing=false,choosing=false,queued=false,authRequired=false,failed=false,workspaceReady=false,saveFailed=false,draftBlocked=false,notice='',epoch=0,syncTimer,authTimer,periodicTimer,indicatorTimer;
 const previous=read(activeStorage,null);
 sourceAccountId=previous?(previous.setupPending?previous.sourceAccountId||null:previous.id):null;
 let guest=read(guestStorage,null);if(!guest&&!previous){guest=App.snapshot();try{store(guestStorage,guest)}catch{}}
 function apply(document){applying=true;try{App.apply(document)}finally{applying=false}}
 // Older releases could show an empty account while the original local shelf
 // remained in the guest slot. Bring that shelf back before any network call.
 if(previous){
  $('#libraryPage').inert=true;$('#add').disabled=true;
  const cached=read(workspaceKey(previous.id),null);
  if(cached?.setupComplete!==true&&realBooks(App.snapshot()).length===0&&realBooks(guest).length){try{apply(validated(guest));sourceAccountId=null}catch{}}
 }
 function syncPopover(open,focus=false){$('#syncPopover').hidden=!open;$('#syncIndicator').setAttribute('aria-expanded',String(open));if(!open&&focus)$('#syncIndicator').focus?.()}
 function accountPage(open=true){syncPopover(false);$('#accountPage').hidden=!open;$('#libraryPage').hidden=open;$('#accountButton').setAttribute('aria-expanded',String(open));if(open)$('#accountHeading').focus?.();else $('#accountButton').focus?.()}
 $('#accountButton').onclick=()=>accountPage($('#accountPage').hidden);$('#backToLibrary').onclick=()=>accountPage(false);$('#reviewSyncSetup').onclick=()=>accountPage();
 function networkMetered(){if(settings.meteredOverride!==null)return settings.meteredOverride;return connection.network?.metered===true||navigator.connection?.saveData===true||navigator.connection?.type==='cellular'}
 const online=()=>navigator.onLine!==false&&connection.network?.online!==false;
 const canAuto=()=>settings.auto&&!networkMetered()&&online()&&!document.hidden&&!authRequired&&account?.id===publicAccount(connection.account)?.id;
 function localDocument(){return S.project(state)}
 function persist(){if(!account)return;if(linked)store(workspaceKey(account.id),{version:1,state,dirty,lastSync,firstPull,setupComplete:true});else store(pendingKey(account.id),{version:1,document:App.snapshot(),sourceAccountId});saveFailed=false;}
 function checkedAgo(value){const elapsed=Date.now()-new Date(value).getTime();if(!Number.isFinite(elapsed))return 'Not checked yet';const minutes=Math.max(0,Math.floor(elapsed/60000));return 'Checked '+(minutes<1?'just now':minutes<60?minutes+' min ago':minutes<1440?Math.floor(minutes/60)+' hr ago':Math.floor(minutes/1440)+' days ago')}
 function renderSyncIndicator(){
  let phase='local',label='Local only',detail='Saved on this device',explanation='Sign in to connect this library to Google Drive. Manual backups are available in Account.';
  const checked=linked&&lastSync?lastSync:preview?.checkedAt,conflicts=account&&linked?localDocument().conflicts.length:0;
  if(!workspaceReady){phase='checking';label='Checking connection';detail='Your library stays here';explanation='Checking the remembered Google connection. Your current library stays on this device.'}
  if(account){
   if(syncing||choosing){phase='syncing';label=choosing?'Connecting library':linked?'Syncing…':'Checking Drive…';detail='Your library stays here';explanation=choosing?'Saving a recovery copy and connecting the chosen library.':linked?'Comparing and saving library changes with Google Drive.':'Checking Drive without uploading your local library.'}
   else if(authRequired){phase='attention';label='Reconnect Google';detail='Changes kept on this device';explanation='Google needs you to sign in again. Open Account to reconnect.'}
   else if(!online()){phase='paused';label='Offline';detail='Saved on this device';explanation='Drive cannot be checked while offline. Changes will wait on this device.'}
   else if(failed){phase='error';label='Sync failed';detail='Changes kept on this device';explanation=notice||'Drive could not be reached. Try Sync now or review Account.'}
   else if(!linked){phase='attention';label='Choose library';detail=checked?checkedAgo(checked):'Waiting to check Drive';explanation='Your current library is still open. Review the library choices in Account before connecting.'}
   else if(conflicts){phase='attention';label='Review sync changes';detail=conflicts+' conflicting '+(conflicts===1?'change':'changes');explanation='Changes are saved, but some values differ between devices. Open Account to choose which values to keep.'}
   else if(draftBlocked&&App.hasDraft?.()){phase='paused';label='Finish editing to sync';detail='Your draft stays open';explanation='Save or close the form before syncing incoming changes.'}
   else if(networkMetered()||!settings.auto){phase='paused';label='Sync paused';detail=networkMetered()?'Metered connection':'Automatic sync is off';explanation=(dirty?'Unsynced changes are saved on this device. ':'Automatic sync is paused. ')+'Sync now is available whenever you choose.'}
   else if(dirty){phase='waiting';label='Changes waiting to sync';detail='Saved on this device';explanation='Local changes are queued for Google Drive.'}
   else if(!lastSync){phase='waiting';label='Waiting to check Drive';detail='Saved on this device';explanation='This library has not completed its first sync on this device.'}
   else{phase='synced';label='Synced';detail=checkedAgo(lastSync);explanation='This device and Google Drive matched at the last successful sync. Changes from another device appear after the next check.'}
  }else if(connection.pending){phase='checking';label='Signing in…';detail='Your library stays here'}
  else if(failed&&!workspaceReady){phase='error';label='Connection unavailable';detail='Your library stays here';explanation=notice}
  if(saveFailed){phase='error';label='Local save needs attention';detail='Download a backup';explanation='The sync queue could not be saved on this device. Download a backup in Account before closing Quiet Screen.'}
  const text=(selector,value)=>{if($(selector).textContent!==value)$(selector).textContent=value};
  $('#syncIndicator').setAttribute('data-state',phase);text('#syncIndicatorLabel',label);text('#syncIndicatorDetail',detail);text('#syncIndicatorAnnouncement',label);
  text('#syncPopoverHeading',label);text('#syncPopoverDetail',explanation);text('#syncPopoverLastSaved',checked?'Last successful '+(linked?'sync: ':'Drive check: ')+new Date(checked).toLocaleString():'No successful Drive '+(linked?'sync':'check')+' on this device yet.');
  $('#syncPopoverLastSaved').hidden=!account;$('#syncIndicator').setAttribute('aria-label',label+' · '+detail+'. Show sync details');
  $('#quickSync').hidden=!account;$('#quickSync').disabled=!account||syncing||choosing||!online()||authRequired||!!connection.pending; text('#quickSync',syncing?'Checking…':linked?'Sync now':'Check Drive');
  text('#syncAccount',authRequired?'Reconnect Google':account&&!linked?'Review library choices':conflicts?'Review changes':'Account & settings');
 }
 function recoveries(){const saved=read(recoveryStorage,[]);return Array.isArray(saved)?saved.filter(entry=>entry&&Array.isArray(entry.copies)):[]}
 function checkpoint(reason,document=App.snapshot()){
  const copies=[{label:'This device before '+reason,document:validated(document)}];
  if(preview)copies.push({label:'Drive before '+reason,document:validated(S.project(preview.state))});
  if(state.registers.length)copies.push({label:'Saved account copy before '+reason,document:validated(localDocument())});
  const entry={id:crypto.randomUUID(),createdAt:new Date().toISOString(),accountId:account?.id||null,sourceAccountId,copies,savedState:state};
  store(recoveryStorage,[entry,...recoveries()].slice(0,3));return entry;
 }
 function recoveryOptions(){return recoveries().flatMap(entry=>entry.copies.flatMap((copy,index)=>{
  if(account?entry.accountId!==account.id:index!==0||entry.sourceAccountId!==null)return [];
  return [{value:entry.id+':'+index,label:copy.label+' · '+new Date(entry.createdAt).toLocaleString(),document:copy.document}];
 }))}
 function renderSetup(){
  const pending=!!account&&!linked,localCount=realBooks(App.snapshot()).length,driveCount=preview?realBooks(S.project(preview.state)).length:null;
  $('#syncSetup').hidden=!pending;$('#syncSetupBanner').hidden=!pending;
  $('#setupLocalCount').textContent=String(localCount);$('#setupDriveCount').textContent=driveCount===null?'—':String(driveCount);
  $('#setupHeading').textContent=preview?driveCount?'Choose how to connect your libraries':'Start syncing this library':'Your library stays here while we check Drive';
  $('#setupExplanation').textContent=!preview?failed?notice:'We’ll check your saved Drive library before uploading or switching anything.':driveCount?'Combine keeps both sets of titles and viewing dates; conflicting changes can be reviewed afterward. Use Drive opens the Drive copy. A recovery copy is saved before either choice.':'Drive has no titles yet. Start syncing to keep this library on screen and save it to your Google account.';
  $('#startSyncLibrary').textContent=driveCount?'Combine libraries':'Start syncing this library';
  $('#startSyncLibrary').disabled=!preview||syncing||choosing||!online();$('#useDriveLibrary').hidden=!driveCount;$('#useDriveLibrary').disabled=!preview||syncing||choosing||!online();
  $('#checkSetupDrive').hidden=!!preview&&!failed;$('#checkSetupDrive').disabled=syncing||choosing||!online();$('#checkSetupDrive').textContent=syncing?'Checking Drive…':'Check Drive';
  $('#setupChoiceStatus').textContent=choosing?'Saving a recovery copy and connecting…':!online()?'Waiting to connect. Keep using your library on this device.':networkMetered()&&!preview?'Automatic checks are paused on this metered connection. Check Drive when ready.':failed?notice:preview?'Nothing switches until you choose.':'';
 }
 function renderAccount(){
  const metered=networkMetered(),paused=!settings.auto||metered||!online();
  $('#accountName').textContent=account?account.name:'Keep it local, or take it with you';$('#accountIdentity').textContent=account?account.email:'Signing in is optional. Your local library works as usual.';
  $('#googleSignIn').hidden=connection.mode==='local'||!!account&&!authRequired;$('#googleSignIn').disabled=!connection.configured||!!connection.pending||syncing||choosing;$('#googleSignIn').textContent=authRequired?'Reconnect Google':'Sign in with Google';
  $('#googleSignOut').hidden=!account;$('#googleSignOut').disabled=syncing||choosing||!!connection.busy;$('#cancelGoogleSignIn').hidden=!connection.pending;
  $('#accountConnection').textContent=connection.pending?'Finish signing in in your browser.':notice||(connection.mode==='local'?'Google sign-in is not configured on this server. Your local library and manual backups remain available.':!connection.configured?'Google sign-in is unavailable in this app build. Install the latest Quiet Screen release. Your local library still works.':account?!linked?'Signed in. Your current library stays open until you choose how to connect it.':connection.rememberSupported===false?'Connected for this app session. Secure credential storage is unavailable.':'Your Google connection is remembered on this device.':connection.platform==='linux'&&connection.rememberSupported===false?'Sign-in works for this session. Unlock or enable your desktop keyring to remember it.':'Connect your own Google Drive to carry your library between devices.');
  $('#autoSync').checked=settings.auto;$('#meteredConnection').checked=metered;$('#resetMetered').hidden=settings.meteredOverride===null;
  $('#meteredStatus').textContent=settings.meteredOverride!==null?'Using your connection setting. Automatic sync is '+(metered?'paused.':'allowed when enabled.'):['Windows','NetworkManager','Android','iOS/iPadOS'].includes(connection.network?.source)&&typeof connection.network?.metered==='boolean'?connection.network.source+' reports a '+(metered?'metered':'unmetered')+' connection.':metered?'Data-saving or a cellular connection was detected. Automatic sync is paused.':'Connection cost could not be determined. Use this switch on a metered connection.';
  $('#syncBadge').textContent=!account?'Local only':syncing?linked?'Syncing':'Checking Drive':authRequired?'Reconnect':!linked?'Choose library':failed?'Needs attention':paused?'Paused':dirty?'Changes waiting':'Connected';
  $('#syncNow').disabled=!account||syncing||choosing||!online()||!!connection.pending;$('#syncNow').textContent=syncing?linked?'Syncing…':'Checking Drive…':linked?'Sync now':'Check Drive';
  $('#syncStatus').textContent=!account?'Sign in to sync your library and view preferences.':!linked?failed?'Waiting to connect. Your current library stays on this device.':'Choose how to connect your current library to Google Drive.':syncing?'Saving and checking Google Drive…':authRequired?'Sign in again to resume. Your changes are still on this device.':failed?notice:!online()?'Offline. Changes stay on this device until you reconnect.':metered?'Automatic sync is paused on this metered connection. Sync now is still available.':!settings.auto?'Automatic sync is off. Use Sync now when you want to connect.':dirty?'Your changes are saved on this device and waiting to sync.':'Your library is saved on this device and connected to Google Drive.';
  $('#syncLastSaved').textContent=linked&&lastSync?'Last synced '+new Date(lastSync).toLocaleString():preview&&!linked?'Drive checked '+new Date(preview.checkedAt).toLocaleString():'';
  const localBooks=realBooks(guest),known=new Set(localDocument().library.map(b=>b.id));$('#copyLocalSection').hidden=!account||!linked||!localBooks.some(b=>!known.has(b.id));$('#copyLocalLibrary').disabled=syncing||choosing;$('#copyLocalHint').textContent=localBooks.length+' titles are kept in your separate signed-out library. You can combine those with this account.';
  $('#storageLabel').textContent=account&&linked?'Saved on this device · '+(dirty?'sync pending':'Google Drive connected'):account?'Saved on this device · choose how to sync':location.protocol==='quiet-screen:'?'Saved on this computer':['android','ios'].includes(connection.mode)?'Saved on this device':'Saved in this browser';
  const projected=account&&linked?localDocument():null,conflicts=projected?.conflicts||[];$('#syncConflictsSection').hidden=!conflicts.length;
  $('#syncConflicts').innerHTML=conflicts.map((conflict,i)=>{
   const p=conflict.parts,title=projected.library.find(item=>item.id===p[1]),list=projected.lists.find(item=>item.id===p[1]);
   const labels={active:'current viewing',history:'viewing dates',episode:'episode viewing',group:'series or franchise',episodic:'episode tracking',name:'list name',member:'list membership',rewatch:'group rewatch',order:'library order',present:'removal',title:'title',format:'format',year:'release year',imdb:'IMDb title'};
   const label=p[0]==='p'?'Theme':(p[0]==='l'?list?.name||'Removed list':title?.title||'Removed title')+' · '+labels[p[2]==='field'?p[3]:p[2]];
   function describe(value){
    if(p[2]==='present')return value?'Keep '+(p[0]==='l'?'this list':'this title'):'Keep deleted';
    if(p[2]==='active')return value?'Started '+(value.started||'on an unknown date'):'No current viewing';
    if(p[2]==='history')return value?'Started '+(value.started||'on an unknown date')+' · Watched '+(value.finished||'on an unknown date'):'Remove viewing';
    if(p[2]==='episode')return value?'S'+value.season+' E'+value.episode+' · '+(value.date||'Date unknown'):'Remove episode viewing';
    if(p[2]==='member')return value?'Keep title in list':'Remove title from list';
    if(p[2]==='rewatch')return value?value.members.length+' installments':'Remove rewatch';
    if(p[3]==='group')return value?.mode==='manual'?value.name:value?.mode==='none'?'Standalone':'Automatic';
    if(p[3]==='episodic')return value?'Track episodes':'Hide episode tracking';
    if(p[0]==='p')return App.themeLabel(value);
    return value||'Clear this value';
   }
   return '<div class="sync-conflict"><strong>'+App.esc(label)+'</strong><label class="sr-only" for="conflict-'+i+'">Value to keep</label><select id="conflict-'+i+'">'+conflict.choices.map((value,n)=>'<option value="'+n+'">'+App.esc(describe(value))+'</option>').join('')+'</select><button data-resolve-conflict="'+i+'" type="button">Keep selected value</button></div>';
  }).join('');
  const options=recoveryOptions(),selected=$('#recoveryChoice').value;$('#recoverySection').hidden=!options.length;$('#recoveryChoice').innerHTML=options.map(option=>'<option value="'+App.esc(option.value)+'">'+App.esc(option.label)+'</option>').join('');if(options.some(o=>o.value===selected))$('#recoveryChoice').value=selected;
  renderSetup();renderSyncIndicator();
 }
 function recordChange(){
  if(applying||!workspaceReady)return;
  try{
   if(!account||!linked){if(!account||sourceAccountId===null){guest=App.snapshot();store(guestStorage,guest)}persist();saveFailed=false;renderAccount();return}
   const changed=S.update(state,App.snapshot(),actor),disk=read(workspaceKey(account.id),null),before=JSON.stringify(state);state=disk?.state?S.merge(changed,disk.state):changed;if(JSON.stringify(state)===before)return;
   if(JSON.stringify(state)!==JSON.stringify(changed))apply(localDocument());dirty=true;persist();failed=false;draftBlocked=false;renderAccount();schedule();
  }catch{failed=true;saveFailed=true;notice='This device could not save the sync queue. Download a backup before closing Quiet Screen.';renderAccount();App.message(notice)}
 }
 App.changed=recordChange;
 function schedule(delay=1500){clearTimeout(syncTimer);if(account&&canAuto())syncTimer=setTimeout(()=>void sync(false),delay)}
 async function request(action,body){const response=await fetch('/api/account/'+action,{method:body===undefined?'GET':'POST',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-Quiet-Screen-Account':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json()}catch{throw Error('The account service is unavailable. Your local library is still available.')}if(!response.ok){const error=Error(data.error||'The Google connection could not be reached.');error.code=data.code;throw error}return data}
 function activate(next){
  if(workspaceReady&&account?.id===next?.id){account=next;return}
  const saved=next?read(workspaceKey(next.id),null):null,nextState=saved?.state?S.validate(saved.state):S.empty();if(next)validated(S.project(nextState));
  const before=App.snapshot(),owner=account&&linked?account.id:sourceAccountId;
  if(account){if(!linked&&sourceAccountId!==null)checkpoint('leaving connection setup');persist()}else if(!previous){guest=before;store(guestStorage,guest)}
  account=next;state=nextState;linked=!!next&&saved?.setupComplete===true;sourceAccountId=owner;preview=null;epoch++;workspaceReady=true;authRequired=false;failed=false;draftBlocked=false;notice='';clearTimeout(syncTimer);
  dirty=saved?.dirty===true;lastSync=saved?.lastSync||null;firstPull=saved?.firstPull===true;
  if(account){store(activeStorage,{...account,setupPending:!linked,sourceAccountId});if(linked){apply(localDocument());sourceAccountId=account.id}else{persist();notice='Your library is still here. Check Drive, then choose how to connect it.'}}
  else{localStorage.removeItem(activeStorage);linked=false;sourceAccountId=null;dirty=false;lastSync=null;firstPull=false;apply(guest||{library:[],preferences:{}})}
  $('#libraryPage').inert=false;$('#add').disabled=false;
 }
 async function sync(manual=false){
  if(linked&&App.hasDraft?.()){draftBlocked=true;notice='Save or close the form before syncing.';renderAccount();return false}
  if(!account||syncing){if(syncing)queued=true;return false}if(!online()||!manual&&!canAuto()){renderAccount();return false}
  clearTimeout(syncTimer);syncing=true;failed=false;draftBlocked=false;notice='';const identity=account.id,revision=epoch,readOnly=!linked,sent=linked?state:S.empty();renderAccount();
  try{
   const response=await request('sync',{accountId:identity,state:sent,readOnly,manual,meteredOverride:settings.meteredOverride});if(response.paused){connection.network=response.network;notice='Automatic sync paused because Windows reports a metered connection.';return false}
   if(account?.id!==identity||epoch!==revision)return false;if(response.account?.id!==identity)throw Error('The sync response belongs to a different account.');
   const returned=S.validate(response.state);validated(S.project(returned));
   if(readOnly){preview={state:returned,checkedAt:new Date().toISOString()};persist();notice='Drive checked. Choose which library to connect; your current titles stay here.';return true}
   const merged=S.merge(state,returned),document=S.project(merged);validated(document);if(App.hasDraft?.()){draftBlocked=true;notice='Drive was checked. Incoming changes will load after you finish editing.';return false}
   state=merged;dirty=!S.covers(returned,merged);lastSync=new Date().toISOString();firstPull=true;persist();apply(document);authRequired=false;notice=document.conflicts.length?'Sync completed. Review the conflicting changes below.':'Sync completed.';return true;
  }catch(e){if(epoch!==revision)return false;failed=true;notice=e.message;if(e.code==='SIGN_IN_REQUIRED')authRequired=true;try{persist()}catch{saveFailed=true;notice+=' Download a backup before closing.'}return false}
  finally{syncing=false;renderAccount();if(linked&&(queued||dirty&&!failed)){queued=false;schedule(2000)}}
 }
 async function chooseLibrary(choice){
  if(!account||linked||syncing||choosing||!preview)return;if(App.hasDraft?.()){notice='Save or close the form before connecting.';renderAccount();return}
  const identity=account.id,offered=JSON.stringify(preview.state);choosing=true;renderAccount();
  try{
   if(!await sync(true)||account?.id!==identity)return;
   if(JSON.stringify(preview.state)!==offered){notice='Drive changed since the preview. Review the updated counts, then choose again.';return}
   if(App.hasDraft?.()){notice='Finish editing before connecting your library.';return}
   const current=App.snapshot(),nextState=choice==='combine'?S.connectLibrary(S.merge(state,preview.state),current,crypto.randomUUID()):S.validate(preview.state),nextDocument=validated(S.project(nextState));
   checkpoint(choice==='combine'?'combining libraries':'using Drive',current);
   const saved={version:1,state:nextState,dirty:choice==='combine',firstPull:true,lastSync:choice==='drive'?preview.checkedAt:lastSync,setupComplete:true},oldCache=localStorage.getItem(workspaceKey(identity)),oldActive=localStorage.getItem(activeStorage);
   try{store(workspaceKey(identity),saved);store(activeStorage,{...account,setupPending:false});apply(nextDocument)}catch(error){try{if(oldCache===null)localStorage.removeItem(workspaceKey(identity));else localStorage.setItem(workspaceKey(identity),oldCache);if(oldActive===null)localStorage.removeItem(activeStorage);else localStorage.setItem(activeStorage,oldActive);apply(current)}catch{}throw error}
   state=nextState;linked=true;sourceAccountId=account.id;dirty=saved.dirty;firstPull=true;lastSync=saved.lastSync;try{localStorage.removeItem(pendingKey(identity))}catch{}notice=choice==='combine'?'Your library is connected. A recovery copy was saved before combining.':'Your Drive library is open. The previous library is kept in a recovery copy.';
  }catch{failed=true;notice='The connection could not be saved safely. Your recovery and local copies are kept; download a backup before retrying.'}
  finally{choosing=false;renderAccount()}
  if(linked&&choice==='combine')await sync(true);
 }
 async function refreshConnection(){
  try{const data=await request('status');connection=data;const next=publicAccount(data.account);
   if(workspaceReady&&next?.id!==account?.id&&App.hasDraft?.()){notice='Finish editing before opening the signed-in account.';renderAccount();clearTimeout(authTimer);authTimer=setTimeout(()=>void refreshConnection(),1200);return}
   activate(next);if(data.error)notice=data.error;renderAccount();if(data.pending||data.busy){clearTimeout(authTimer);authTimer=setTimeout(()=>void refreshConnection(),1200)}else if(next&&!syncing&&(!linked||!firstPull||dirty))schedule(100);
  }catch(e){notice=e.message;failed=true;const remembered=publicAccount(read(activeStorage,null));if(!account&&remembered){try{activate(remembered);notice='Waiting to reconnect. Your library is kept on this device.';authRequired=true}catch{}}renderAccount()}
 }
 $('#googleSignIn').onclick=async()=>{if(connection.mode==='web'){location.assign('/api/account/start');return}try{connection=await request('start',{});notice='';renderAccount();clearTimeout(authTimer);authTimer=setTimeout(()=>void refreshConnection(),1000)}catch(e){notice=e.message;renderAccount()}};
 $('#cancelGoogleSignIn').onclick=async()=>{try{connection=await request('cancel',{});notice='Sign-in cancelled.';renderAccount()}catch(e){notice=e.message;renderAccount()}};
 $('#googleSignOut').onclick=async()=>{if(syncing||choosing)return;try{persist();if(linked&&dirty&&!confirm('Some changes have not synced yet. They will stay on this device for this Google account. Sign out?'))return;connection=await request('signout',{});activate(null);notice='Signed out. Your separate local library is open.';renderAccount()}catch(e){notice=e.message;renderAccount()}};
 $('#syncNow').onclick=$('#checkSetupDrive').onclick=()=>sync(true);$('#startSyncLibrary').onclick=()=>chooseLibrary('combine');$('#useDriveLibrary').onclick=()=>chooseLibrary('drive');$('#setupLater').onclick=()=>accountPage(false);
 $('#syncIndicator').onclick=()=>{renderSyncIndicator();syncPopover($('#syncPopover').hidden)};$('#quickSync').onclick=()=>sync(true);$('#syncAccount').onclick=()=>accountPage();
 document.addEventListener('click',event=>{if(!$('#syncPopover').hidden&&!event.target.closest('#syncOverview'))syncPopover(false)});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#syncPopover').hidden){event.preventDefault();syncPopover(false,true)}});
 $('#autoSync').onchange=()=>{settings.auto=$('#autoSync').checked;try{store(settingsStorage,settings)}catch{}renderAccount();if(settings.auto)schedule(100);else clearTimeout(syncTimer)};
 $('#meteredConnection').onchange=()=>{settings.meteredOverride=$('#meteredConnection').checked;try{store(settingsStorage,settings)}catch{}renderAccount();if(networkMetered())clearTimeout(syncTimer);else schedule(100)};
 $('#resetMetered').onclick=()=>{settings.meteredOverride=null;try{store(settingsStorage,settings)}catch{}renderAccount();schedule(100)};
 $('#copyLocalLibrary').onclick=()=>{if(!account||!linked||syncing||choosing||App.hasDraft?.())return;try{checkpoint('adding local titles');state=S.connectLibrary(state,guest,crypto.randomUUID());dirty=true;persist();apply(localDocument());renderAccount();schedule()}catch{notice='Local titles could not be combined safely. Keep a backup and try again.';renderAccount()}};
 $('#downloadRecovery').onclick=()=>{try{const options=recoveryOptions(),selected=options.find(option=>option.value===$('#recoveryChoice').value)||options[0];if(selected){App.downloadBackup(validated(selected.document),'quiet-screen-recovery');App.message('Recovery copy downloaded. Restore it whenever you need it.')}}catch{App.message('The recovery copy could not be downloaded. The saved copy remains on this device.')}};
 $('#syncConflicts').onclick=e=>{const button=e.target.closest('[data-resolve-conflict]');if(!button||!account||!linked)return;const i=Number(button.dataset.resolveConflict),conflict=localDocument().conflicts[i];if(!conflict)return;try{state=S.resolve(state,conflict.key,Number($('#conflict-'+i).value),actor);dirty=true;persist();apply(localDocument());renderAccount();schedule()}catch(e){notice=e.message;renderAccount()}};
 root.addEventListener('online',()=>{renderAccount();schedule(100)});root.addEventListener('offline',renderAccount);
 navigator.connection?.addEventListener('change',()=>{renderAccount();if(networkMetered())clearTimeout(syncTimer);else schedule(100)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshConnection();schedule(100)}});
 root.addEventListener('storage',event=>{if(account&&linked&&event.key===workspaceKey(account.id)){try{const incoming=read(event.key,null);if(incoming?.state){state=S.merge(state,incoming.state);dirty=dirty||incoming.dirty;persist();if(!App.hasDraft?.())apply(localDocument());renderAccount();schedule()}}catch{notice='Another window’s changes could not be loaded. Keep a backup before closing.';renderAccount()}}});
 periodicTimer=setInterval(()=>{if(account&&online()&&!document.hidden)void refreshConnection().then(()=>{if(canAuto())return sync(false)})},120000);
 if(new URL(location.href).searchParams.has('account')){accountPage();history.replaceState(null,'',location.pathname)}
 indicatorTimer=setInterval(()=>{if(!document.hidden)renderSyncIndicator()},30000);
 const headerObserver=root.ResizeObserver?new root.ResizeObserver(entries=>{document.documentElement.style.setProperty('--app-header-height',Math.ceil(entries[0].target.getBoundingClientRect().height)+'px')}):null;headerObserver?.observe($('.app-header'));
 root.QuietScreenAccount={refresh:refreshConnection,sync,resume(){renderAccount();schedule(100)},status:()=>({account,dirty,lastSync,firstPull,syncing,online:online(),metered:networkMetered(),auto:settings.auto,setupPending:!!account&&!linked,setupReady:!!preview}),dispose(){clearTimeout(syncTimer);clearTimeout(authTimer);clearInterval(periodicTimer);clearInterval(indicatorTimer);headerObserver?.disconnect()}};
 renderAccount();void refreshConnection();
})(globalThis);
