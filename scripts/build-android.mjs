import {prepareAndroidSource} from './prepare-android-source.mjs';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['scripts/prepare-android.mjs'],{stdio:'inherit'});
const production=process.argv.includes('--release'),version=JSON.parse(readFileSync('package.json','utf8')).version;
const env={...process.env},encoded=env.QUIET_SCREEN_ANDROID_KEYSTORE_BASE64,password=env.QUIET_SCREEN_ANDROID_KEYSTORE_PASSWORD;
if(!!encoded!==!!password)throw Error('Both Android signing secrets are required together.');
if(production&&!encoded)throw Error('Release builds require both Android signing secrets.');
if(encoded){const folder=join(env.RUNNER_TEMP||resolve('private'),'quiet-screen-android-signing');mkdirSync(folder,{recursive:true,mode:0o700});const file=join(folder,'quiet-screen.p12');writeFileSync(file,Buffer.from(encoded,'base64'),{mode:0o600});env.QUIET_SCREEN_ANDROID_KEYSTORE_FILE=file;}
const gradle=process.platform==='win32'?'gradlew.bat':'./gradlew';
execFileSync(gradle,['--no-daemon','--console=plain',':app:assembleRelease',':app:assembleDebug',':app:assembleDebugAndroidTest',':app:lintRelease'],{cwd:'android',env,stdio:'inherit'});
const output=resolve('work/android');mkdirSync(output,{recursive:true});
const signed=!!encoded,file=signed?'app-release.apk':'app-release-unsigned.apk',name=signed?`Quiet-Screen-Android-${version}.apk`:`Quiet-Screen-Android-${version}-unsigned.apk`;
copyFileSync('android/app/build/outputs/apk/release/'+file,join(output,name));
if(signed){const sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT;if(!sdk)throw Error('ANDROID_HOME is required to verify the signed APK.');const versions=readdirSync(join(sdk,'build-tools')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),tool=join(sdk,'build-tools',versions.at(-1),process.platform==='win32'?'apksigner.bat':'apksigner');const certificate=execFileSync(tool,['verify','--verbose','--print-certs',join(output,name)],{env,encoding:'utf8'});writeFileSync(join(output,'android-signing-certificate.txt'),certificate.split(/\r?\n/).filter(line=>/certificate (SHA-1|SHA-256) digest:/.test(line)).join('\n')+'\n');}
const thirdPartySource=await prepareAndroidSource(output);
const digest=createHash('sha256').update(readFileSync(join(output,name))).digest('hex');writeFileSync(join(output,'SHA256SUMS-Android.txt'),digest+'  '+name+'\n'+thirdPartySource.sha256+'  '+thirdPartySource.filename+'\n');
writeFileSync(join(output,'android-build.json'),JSON.stringify({version,filename:name,sha256:digest,signed,sourceSha:env.GITHUB_SHA||'',thirdPartySource}));
console.log('Android package ready: '+join(output,name));
