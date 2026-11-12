// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0

import { validEpisode, validGroup, validLists } from '../library.mjs';

/* Shared by the browser, Windows app and Drive adapter. No credentials belong here. */
(function(root){
 'use strict';
 const SCHEMA=1,MAX_BYTES=10*1024*1024;
 const fields=new Set(["title","format","year","imdb","order","group","episodic"]);
 const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const key=parts=>JSON.stringify(parts),dotKey=h=>h.dot.join(':');
 function empty(){return {schema:SCHEMA,clock:{},registers:[]}}
 function plain(v){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==null}
 function validClock(v){return plain(v)&&Object.keys(v).length<=10000&&Object.entries(v).every(([a,n])=>/^[a-zA-Z0-9_-]{1,100}$/.test(a)&&!['__proto__','constructor','prototype'].includes(a)&&Number.isSafeInteger(n)&&n>0)}
 function calendarDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value}
 function validValue(p,v){
  if(p[0]==='l'){
   if(p[2]==='present'||p[2]==='member')return typeof v==='boolean'||p[2]==='member'&&v===null;
   if(v===null)return true;
   if(p[2]==='name')return typeof v==='string'&&!!v.trim()&&v.length<=120;
   return validLists([{id:p[1],name:'Rewatch',members:v?.members,rewatch:{group:v?.group,baseline:v?.baseline}}]);
  }
  if(p[0]==='p')return v===null||['ink','sage','tide','rosewood','porcelain','apricot'].includes(v);
  if(p[2]==='present')return typeof v==='boolean';
  if(v===null)return true;
  if(p[2]==='active')return plain(v)&&(v.started===null||calendarDate(v.started))&&
   (v.id===undefined||typeof v.id==='string'&&v.id.length<=100);
  if(p[2]==='episode')return v.id===p[3]&&validEpisode(v);
  if(p[3]==='group')return validGroup(v);
  if(p[3]==='episodic')return typeof v==='boolean';
  if(p[2]==='history')return plain(v)&&v.id===p[3]&&
   (v.started===null||calendarDate(v.started))&&(v.finished===null||calendarDate(v.finished))&&
   (!v.started||!v.finished||v.started<=v.finished);
  if(p[3]==='year')return typeof v==='string'&&/^(\d{4})?$/.test(v);
  if(p[3]==='imdb')return typeof v==='string'&&/^(tt\d{7,})?$/.test(v);
  return typeof v==='string'&&!!v.trim()&&v.length<=300;
 }
 function validate(state){
  if(!state||state.schema!==SCHEMA||!validClock(state.clock)||!Array.isArray(state.registers)||state.registers.length>300000||JSON.stringify(state).length>MAX_BYTES)throw Error('The sync copy is invalid or too large.');
  const seen=new Set();
  for(const pair of state.registers){
   if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||seen.has(pair[0])||!Array.isArray(pair[1])||!pair[1].length||pair[1].length>128)throw Error('Invalid sync register.');seen.add(pair[0]);
   let p;try{p=JSON.parse(pair[0])}catch{throw Error('Invalid sync key.')}
   if(!Array.isArray(p)||p.some(x=>typeof x!=='string'||x.length>1000)||!(p[0]==='b'&&p.length>=3&&p.length<=4&&p[1]&&(['present','active'].includes(p[2])&&p.length===3||p[2]==='field'&&p.length===4&&fields.has(p[3])||['history','episode'].includes(p[2])&&p.length===4&&p[3])||p[0]==='l'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p[1])&&(['present','name','rewatch'].includes(p[2])&&p.length===3||p[2]==='member'&&p.length===4&&p[3])||p[0]==='p'&&p.length===2&&p[1]==='theme'))throw Error('Unsupported sync key.');
   const dots=new Set();
   for(const h of pair[1]){if(!h||!Array.isArray(h.dot)||h.dot.length!==2||!validClock({[h.dot[0]]:h.dot[1]})||!validClock(h.context)||!Object.hasOwn(h,'value')||!validValue(p,h.value)||dots.has(dotKey(h))||(state.clock[h.dot[0]]||0)<h.dot[1]||(h.context[h.dot[0]]||0)>=h.dot[1]||Object.entries(h.context).some(([actor,n])=>(state.clock[actor]||0)<n))throw Error('Invalid sync change.');dots.add(dotKey(h))}
  }
  return clone(state);
 }
 const dominates=(a,b)=>(a.context[b.dot[0]]||0)>=b.dot[1];
 function merge(...states){
  const result=empty(),registers=new Map();
  for(const raw of states){const s=validate(raw);for(const [actor,n]of Object.entries(s.clock))result.clock[actor]=Math.max(result.clock[actor]||0,n);for(const [k,heads]of s.registers){let bucket=registers.get(k)||new Map();for(const h of heads){const existing=bucket.get(dotKey(h));if(existing&&!same(existing,h))throw Error('Conflicting sync change identifiers.');bucket.set(dotKey(h),h)}registers.set(k,bucket)}}
  for(const [k,bucket]of [...registers].sort(([a],[b])=>a.localeCompare(b))){const all=[...bucket.values()];result.registers.push([k,all.filter(h=>!all.some(other=>other!==h&&dominates(other,h))).sort((a,b)=>dotKey(a).localeCompare(dotKey(b)))])}
  return validate(result);
 }
 function flatten(document){
  if(!document||!Array.isArray(document.library)||document.library.length>10000||new Set(document.library.map(title=>title.id)).size!==document.library.length)throw Error('Invalid library.');
  const out=new Map();
  for(const title of document.library){
   if(!title||typeof title.id!=='string'||!title.id||typeof title.title!=='string'||!title.title.trim()||!Array.isArray(title.history))throw Error('Invalid title.');
   out.set(key(['b',title.id,'present']),true);
   for(const name of fields)if(title[name]!==undefined)out.set(key(['b',title.id,'field',name]),title[name]);
   out.set(key(['b',title.id,'active']),title.active);
   for(const view of title.episodes||[])out.set(key(['b',title.id,'episode',view.id]),view);
   for(const view of title.history){
    if(!view||typeof view.id!=='string'||!view.id)throw Error('Invalid viewing history.');
    out.set(key(['b',title.id,'history',view.id]),{id:view.id,started:view.started,finished:view.finished});
   }
  }
  if(!validLists(document.lists||[]))throw Error('Invalid lists.');
  for(const list of document.lists||[]){
   out.set(key(['l',list.id,'present']),true);
   out.set(key(['l',list.id,'name']),list.name);
   if(list.rewatch)out.set(key(['l',list.id,'rewatch']),{...list.rewatch,members:list.members});
   else for(const id of list.members)out.set(key(['l',list.id,'member',id]),true);
  }
  if(document.preferences?.theme!==undefined)out.set(key(['p','theme']),document.preferences.theme);
  return out;
 }
 function chosen(heads,parts){return parts[2]==='present'&&heads.some(h=>h.value===false)?heads.find(h=>h.value===false):heads.at(-1)}
 function project(state){
  const library=new Map(),lists=new Map(),preferences={},conflicts=[];
  for(const [k,heads]of state.registers){
   const p=JSON.parse(k),value=chosen(heads,p).value;
   if(heads.length>1&&heads.some(h=>!same(h.value,heads[0].value)))conflicts.push({key:k,parts:p,choices:heads.map(h=>clone(h.value))});
   if(p[0]==='p'){if(value!==null)preferences.theme=value;continue}
   if(p[0]==='l'){
    const list=lists.get(p[1])||{id:p[1],members:[]};
    lists.set(p[1],list);
    if(p[2]==='present')list._present=value===true;
    if(p[2]==='name'&&value!==null)list.name=value;
    if(p[2]==='member'&&value)list.members.push(p[3]);
    if(p[2]==='rewatch'&&value!==null)list.rewatch=clone(value);
    continue;
   }
   const title=library.get(p[1])||{id:p[1],active:null,history:[],episodes:[],year:'',imdb:''};
   library.set(p[1],title);
   if(p[2]==='present')title._present=value===true;
   if(p[2]==='field'&&value!==null)title[p[3]]=value;
   if(p[2]==='active')title.active=clone(value);
   if(p[2]==='history'&&value)title.history.push(clone(value));
   if(p[2]==='episode'&&value)title.episodes.push(clone(value));
  }
  const titles=[...library.values()].filter(title=>title._present).map(title=>{delete title._present;return title});
  titles.sort((a,b)=>String(a.order||'').localeCompare(String(b.order||''))||a.id.localeCompare(b.id));
  const visibleLists=[...lists.values()].filter(list=>list._present).map(list=>{
   delete list._present;
   if(list.rewatch){const {members,...rewatch}=list.rewatch;list.members=members;list.rewatch=rewatch}
   return list;
  });
  return {library:titles,lists:visibleLists,preferences,conflicts};
 }
 function writer(state,actor){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(actor)||['__proto__','constructor','prototype'].includes(actor))throw Error('Invalid device identifier.');const registers=new Map(state.registers);return {put(k,value){const context={...state.clock},n=(state.clock[actor]||0)+1;state.clock[actor]=n;registers.set(k,[{dot:[actor,n],context,value:clone(value)}])},finish(){state.registers=[...registers].sort(([a],[b])=>a.localeCompare(b));return validate(state)}}}
 function update(raw,document,actor){
  const state=validate(raw),before=flatten(project(state)),after=flatten(document),write=writer(state,actor),changedBooks=new Set();
  for(const [k,value]of after)if(!before.has(k)||!same(value,before.get(k))){write.put(k,value);const p=JSON.parse(k);if(['b','l'].includes(p[0]))changedBooks.add(key([p[0],p[1],'present']))}
  for(const [k]of before)if(!after.has(k)){const p=JSON.parse(k);if(['b','l'].includes(p[0])&&!after.has(key([p[0],p[1],'present']))){if(p[2]==='present')write.put(k,false)}else write.put(k,null);if(['b','l'].includes(p[0]))changedBooks.add(key([p[0],p[1],'present']))}
  for(const key of changedBooks)if(after.has(key))write.put(key,true);
  return write.finish();
 }
 function resolve(raw,k,choice,actor){const s=validate(raw),heads=new Map(s.registers).get(k);if(!heads||!Number.isInteger(choice)||choice<0||choice>=heads.length)throw Error('Invalid conflict choice.');const w=writer(s,actor);w.put(k,heads[choice].value);return w.finish()}
 function covers(newer,older){const all=new Map(newer.registers);return older.registers.every(([k,heads])=>heads.every(old=>(all.get(k)||[]).some(h=>dotKey(h)===dotKey(old)||dominates(h,old))))}
 function connectLibrary(remote,document,actor){
  const library=document.library,local=update(empty(),{library,lists:document.lists,preferences:{}},actor+'_import');let combined=merge(remote,local);
  // The user explicitly chose to keep the titles currently on this device.
  // Restore any of those titles whose old Drive copy had been deleted.
  for(const [kind,items] of [['b',library],['l',document.lists||[]]])for(const item of items){const k=key([kind,item.id,'present']),heads=new Map(combined.registers).get(k);if(heads?.some(h=>h.value===false))combined=resolve(combined,k,heads.findIndex(h=>h.value===true),actor)}
  const current=project(combined),preferences={...current.preferences,...document.preferences};
  return update(combined,{library:current.library,lists:current.lists,preferences},actor);
 }
 const api={SCHEMA,MAX_BYTES,empty,validate,merge,project,update,resolve,covers,connectLibrary};root.QuietScreenSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
