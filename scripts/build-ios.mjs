// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const run=(command,args)=>{const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)throw Error(command+' failed')};
if(process.platform!=='darwin')throw Error('Native iOS builds require macOS with Xcode. Use the public iOS workflow from another OS.');
const version=JSON.parse(readFileSync('package.json')).version,parts=version.split('.').map(Number),number=(parts[0]+1)+'.'+parts[1]+'.'+parts[2];
const id=(process.env.QUIET_SCREEN_GOOGLE_IOS_CLIENT_ID||'').trim();
if(id&&!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id))throw Error('Invalid public iOS OAuth client ID.');
const args=['-project','ios/QuietScreen.xcodeproj','-scheme','QuietScreen','-onlyUsePackageVersionsFromResolvedFile','CODE_SIGNING_ALLOWED=NO',`MARKETING_VERSION=${version}`,`CURRENT_PROJECT_VERSION=${number}`];
if(id)args.push('QUIET_SCREEN_IOS_CLIENT_ID='+id,'QUIET_SCREEN_IOS_REVERSED_CLIENT_ID='+id.split('.').reverse().join('.'));
const dir=resolve('work/ios');mkdirSync(dir,{recursive:true});
// sips is supplied by macOS; no downloaded project-generator dependency.
const icon='ios/QuietScreen/Assets.xcassets/AppIcon.appiconset';mkdirSync(icon,{recursive:true});
run('sips',['-z','1024','1024','desktop/assets/icon.png','--out',icon+'/AppIcon.png']);
writeFileSync(icon+'/Contents.json',JSON.stringify({images:[{filename:'AppIcon.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}}));
run(process.execPath,['scripts/prepare-ios.mjs']);
const mode=process.argv[2]||'device';
if(mode==='resolve'){run('xcodebuild',[...args,'-resolvePackageDependencies','-clonedSourcePackagesDirPath',join(dir,'packages')]);process.exit(0)}
if(mode==='test'){
 const destination=process.env.QUIET_SCREEN_IOS_TEST_DESTINATION;if(!destination)throw Error('Choose an actual iPhone or iPad Simulator destination.');
 run('xcodebuild',[...args,'ONLY_ACTIVE_ARCH=YES','ARCHS='+(process.arch==='arm64'?'arm64':'x86_64'),'-configuration','Debug','-destination',destination,'-derivedDataPath',join(dir,'derived'),'-clonedSourcePackagesDirPath',join(dir,'packages'),'-resultBundlePath',join(dir,process.env.QUIET_SCREEN_IOS_TEST_RESULT||'runtime.xcresult'),'-parallel-testing-enabled','NO','test']);
}else if(mode==='device'){
 if(!id)console.log('Building a guest-capable IPA; native Google sign-in awaits its public iOS client ID.');
 run('xcodebuild',[...args,'-configuration','Release','-sdk','iphoneos','-destination','generic/platform=iOS','-derivedDataPath',join(dir,'device-derived'),'-clonedSourcePackagesDirPath',join(dir,'packages'),'build']);
 const payload=join(dir,'package/Payload');mkdirSync(payload,{recursive:true});
 run('ditto',[join(dir,'device-derived/Build/Products/Release-iphoneos/QuietScreen.app'),join(payload,'QuietScreen.app')]);
 const result=spawnSync('zip',['-q','-r',join(dir,`Quiet-Screen-iOS-${version}-unsigned.ipa`),'Payload'],{cwd:join(dir,'package'),stdio:'inherit'});if(result.status!==0)throw Error('IPA packaging failed');
 copyFileSync('ios/INSTALL.md',join(dir,'INSTALL-iPhone-iPad.md'));
 console.log('Unsigned universal IPA prepared. AltStore must sign it before it can be installed.');
}else throw Error('Use resolve, test, or device.');
