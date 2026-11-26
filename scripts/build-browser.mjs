import {zipSync,strToU8} from 'fflate'
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {sharedAssets} from './platform-assets.mjs'
const files={}
const list=[...sharedAssets,'server.mjs','app-response.mjs','imdb-episodes.mjs','sync/google-oauth.mjs','sync/web-account.mjs','package.json','platform-manifest.json','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md']
for(const name of list)files['quiet-screen/'+name]=new Uint8Array(readFileSync(name))
if(existsSync('desktop/google-client.generated.json'))files['quiet-screen/desktop/google-client.generated.json']=new Uint8Array(readFileSync('desktop/google-client.generated.json'))
files['quiet-screen/start-windows.bat']=strToU8('@echo off\r\ncd /d "%~dp0"\r\nnode server.mjs\r\npause\r\n')
files['quiet-screen/start-mac.command']=strToU8('#!/bin/sh\ncd "$(dirname "$0")"\nexec node server.mjs\n')
files['quiet-screen/INSTALL.txt']=strToU8('Quiet Screen local browser app\nInstall Node.js 24 or later. Run node server.mjs in this folder.\nOpen http://127.0.0.1:4178 using the same browser profile and address to preserve storage.\nKeep the private/ folder during updates. No npm install is required.\n')
mkdirSync('work/browser',{recursive:true});const bytes=zipSync(files)
writeFileSync('work/browser/quiet-screen-pc.zip',bytes)
writeFileSync('work/browser/SHA256SUMS-Browser.txt',createHash('sha256').update(bytes).digest('hex')+'  quiet-screen-pc.zip\n')
