# Copyright 2026 Alex (Ayca Kaygusuz)
# SPDX-License-Identifier: Apache-2.0
import json,subprocess,os,pathlib,platform
available=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json']))['devices']
# Xcode 16.4 supplies iOS 18.5; choose installed devices, never assume a UUID.
sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-version'],text=True).strip().replace('.','-')
choices=[(runtime,device) for runtime,devices in available.items() if runtime.endswith('iOS-'+sdk) for device in devices if device.get('isAvailable')]
selected=[]
for label,word in [('ipad','iPad Pro 13'),('iphone','iPhone 16')]:
 matches=[(runtime,device) for runtime,device in choices if word in device['name']]
 if not matches: raise SystemExit('Required Simulator missing: '+word)
 runtime,device=sorted(matches,key=lambda item:(item[0],item[1]['name']),reverse=True)[0]
 selected.append({'label':label,'runtime':runtime,'name':device['name'],'udid':device['udid']})
for device in selected:
 print('Testing',device['name'],device['runtime'],flush=True)
 env=dict(os.environ,QUIET_SCREEN_IOS_TEST_DESTINATION='platform=iOS Simulator,id='+device['udid']+',arch='+('arm64' if platform.machine()=='arm64' else 'x86_64'),QUIET_SCREEN_IOS_TEST_RESULT=device['label']+'-runtime.xcresult')
 subprocess.run(['node','scripts/build-ios.mjs','test'],env=env,check=True,timeout=1200)
 subprocess.run(['xcrun','simctl','shutdown',device['udid']],check=False)
pathlib.Path('work/ios/simulator-results.json').write_text(json.dumps(selected,indent=2)+'\n')
