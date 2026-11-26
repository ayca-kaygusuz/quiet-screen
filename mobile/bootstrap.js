// Native tokens stay in the Android / iOS adapter, never in page scripts.
(function(){
 const ios=location.protocol==='quiet-screen-ios:',platform=ios?'ios':'android'
 const native=ios?globalThis.webkit?.messageHandlers?.QuietScreenNative:globalThis.QuietScreenNative
 if(!native)return
 document.documentElement.dataset.platform=platform
 if(!crypto.randomUUID)crypto.randomUUID=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
 const pending=new Map();let next=0
 if(!ios)native.onmessage=event=>{let data;try{data=JSON.parse(event.data)}catch{return}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Object.assign(Error(data.error),{code:data.code})):p.resolve(data.value)}
 function rpc(method,parameters={},signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'))
  const id=++next
  const cleanup=()=>{clearTimeout(timer);pending.delete(id);signal?.removeEventListener('abort',abort)}
  const done=value=>{cleanup();resolve(value)},fail=reason=>{cleanup();const error=reason instanceof Error?reason:Error(String(reason));if(error.message.includes('SIGN_IN_REQUIRED'))error.code='SIGN_IN_REQUIRED';reject(error)}
  const abort=()=>{if(method==='http'){const message={id:++next,method:'http.cancel',parameters:{requestId:id}};if(ios)void native.postMessage(message).catch(()=>{});else native.postMessage(JSON.stringify(message))}fail(new DOMException('Aborted','AbortError'))}
  const timer=setTimeout(abort,120000);signal?.addEventListener('abort',abort,{once:true})
  if(ios)native.postMessage({id,method,parameters}).then(done,fail)
  else{pending.set(id,{resolve:done,reject:fail});native.postMessage(JSON.stringify({id,method,parameters}))}
 })}
 const bridge={rpc};globalThis.QuietScreenMobile=bridge
 globalThis[ios?'QuietScreenIOS':'QuietScreenAndroid']=bridge
 const api=import('/mobile/native-api.mjs').then(m=>m.createNativeAPI({rpc,platform}))
 globalThis.fetch=async(input,options={})=>{
  const request=new Request(new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href),input instanceof Request?new Request(input,options):options)
  const url=new URL(request.url),local=url.protocol===location.protocol&&url.host===location.host
  if(local&&!url.pathname.startsWith('/api/'))return new Response(await rpc('asset.read',{name:url.pathname.slice(1)}),{headers:{'Content-Type':'text/plain; charset=utf-8'}})
  return local?(await api).handle(request):(await api).external(request)
 }
 window.open=url=>{void rpc('open.external',{url:String(url)}).catch(()=>{});return null}
 addEventListener('DOMContentLoaded',()=>{
  document.body.dataset.platform=platform
  const configure=()=>{
   const App=globalThis.QuietScreenApp;if(!App){setTimeout(configure,25);return}
   App.downloadBackup=document=>void rpc('backup.save',{document:App.backupDocument(document)}).then(saved=>{if(saved)App.message('Backup saved.')}).catch(e=>App.message(e.message))
   for(const id of ['backup','account-backup'])document.getElementById(id).onclick=()=>App.downloadBackup(App.snapshot())
   for(const id of ['restore','account-restore'])document.getElementById(id).onclick=async()=>{try{const data=await rpc('backup.open');if(data!==null)App.importBackup(data)}catch(e){App.message(e.message)}}
   const detail=document.getElementById('detail'),close=document.createElement('button');close.type='button';close.className='mobile-close-detail';close.textContent='← Library'
   const compact=matchMedia('(max-width:719px)')
   function state(){const modal=compact.matches&&document.body.classList.contains('mobile-detail-open');for(const element of document.querySelectorAll('.layout > section:first-child,.app-header,.intro,#insights,.library-navigation,#list-tabs,#list-context,footer'))element.inert=modal;if(modal){detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true')}else{detail.removeAttribute('role');detail.removeAttribute('aria-modal')}}
   close.onclick=()=>{document.body.classList.remove('mobile-detail-open');state()}
   document.getElementById('titles').addEventListener('click',event=>{if(!event.target.closest('button.row'))return;if(!detail.contains(close))detail.prepend(close);document.body.classList.add('mobile-detail-open');state();detail.scrollTop=0;if(compact.matches)close.focus()})
   new MutationObserver(()=>{if(document.body.classList.contains('mobile-detail-open')&&!detail.contains(close))detail.prepend(close)}).observe(detail,{childList:true})
   compact.addEventListener('change',state)
   bridge.back=()=>{const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return true}if(!document.getElementById('accountPage').hidden){document.getElementById('backToLibrary').click();return true}if(document.body.classList.contains('mobile-detail-open')){close.click();return true}return false}
   document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(a&&new URL(a.href).protocol==='https:'){event.preventDefault();void rpc('open.external',{url:a.href}).catch(e=>App.message(e.message))}})
   const appearance=()=>{const style=getComputedStyle(document.documentElement);void rpc('app.appearance',{color:style.getPropertyValue('--bg').trim(),light:style.colorScheme==='light'}).catch(()=>{})};appearance();new MutationObserver(appearance).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})
  };configure()
 })
})();
