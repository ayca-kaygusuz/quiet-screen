// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Redistribute the unmodified compatibility library's source beside the APK.
// Keep upstream GPLv2 + Classpath Exception notices; do not relabel this source.
export async function prepareAndroidSource(output='work/android'){
 const pin=JSON.parse(readFileSync('assets/licenses/desugar-jdk-source.json','utf8'));
 if(pin.version!=='2.1.5'||pin.filename!==`desugar_jdk_libs-${pin.version}-source.zip`||!/^[a-f0-9]{40}$/.test(pin.revision)||!/^[a-f0-9]{64}$/.test(pin.sha256)||pin.url!==`https://codeload.github.com/google/desugar_jdk_libs/zip/${pin.revision}`)throw Error('Invalid Android runtime source configuration.');
 mkdirSync(output,{recursive:true});const file=join(output,pin.filename),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 if(!existsSync(file)||digest(readFileSync(file))!==pin.sha256){
  const response=await fetch(pin.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('The upstream Android runtime source could not be downloaded.');
  let size=0;const chunks=[];for await(const bytes of response.body){size+=bytes.length;if(size>32*1024*1024)throw Error('The upstream source archive is too large.');chunks.push(bytes)}
  const bytes=Buffer.concat(chunks);if(digest(bytes)!==pin.sha256)throw Error('The upstream Android runtime source checksum does not match.');writeFileSync(file,bytes);
 }
 return {filename:pin.filename,sha256:pin.sha256,revision:pin.revision};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await prepareAndroidSource();console.log('Verified Android runtime source: '+result.filename)}
