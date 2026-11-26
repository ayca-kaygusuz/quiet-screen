import zipfile,plistlib,pathlib,json,hashlib,os
version=json.loads(pathlib.Path('package.json').read_text())['version']
path=pathlib.Path(f'work/ios/Quiet-Screen-iOS-{version}-unsigned.ipa')
with zipfile.ZipFile(path) as package:
    names=package.namelist()
    info=plistlib.loads(package.read('Payload/QuietScreen.app/Info.plist'))
    assert info['CFBundleIdentifier']=='com.quietscreen.ios'
    assert set(info['UIDeviceFamily'])=={1,2}
    assert not info.get('UIRequiresFullScreen',False)
    assert info['CFBundleShortVersionString']==version
    for file in ['index.html','app.mjs','library.mjs','sync/sync-core.js','mobile/bootstrap.js','mobile/native-api.mjs','license.txt','NOTICE','THIRD_PARTY_NOTICES.md','native-notices.txt']:
        assert 'Payload/QuietScreen.app/Web/'+file in names,file
    assert not any(name.endswith(('.p12','.jks','google-client.generated.json')) for name in names)
    assert not any('/_CodeSignature/' in name for name in names)
digest=hashlib.sha256(path.read_bytes()).hexdigest()
path.with_name('SHA256SUMS-iOS.txt').write_text(digest+'  '+path.name+'\n')
path.with_name('ios-build.json').write_text(json.dumps({'version':version,'sourceSha':os.environ.get('GITHUB_SHA',''),'filename':path.name,'sha256':digest,'unsigned':True})+'\n')
print('PASS: unsigned universal iPhone/iPad package, shared assets and retained notices.')
