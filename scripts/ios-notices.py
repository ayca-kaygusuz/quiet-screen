# Copyright 2026 Alex (Ayca Kaygusuz)
# SPDX-License-Identifier: Apache-2.0
"""Retain upstream licenses from the exact resolved Swift packages; fail closed."""
import pathlib,json,subprocess
root=pathlib.Path('work/ios/packages/checkouts')
lock=pathlib.Path('ios/QuietScreen.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved')
pins=json.loads(lock.read_text())['pins']
output=['iOS native runtime dependencies. Apple system frameworks retain Apple terms.\n', 'Swift runtime notice (upstream Swift 6.1.2): https://github.com/swiftlang/swift/blob/swift-6.1.2-RELEASE/LICENSE.txt\n', pathlib.Path('ios/licenses/swift-runtime-LICENSE.txt').read_text()]
for pin in pins:
 identity=pin['identity']; revision=pin['state']['revision']
 candidates=[p for p in root.iterdir() if p.is_dir() and subprocess.run(['git','-C',str(p),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()==revision]
 if len(candidates)!=1: raise SystemExit('Resolved package checkout missing: '+identity)
 checkout=candidates[0]
 files=sorted({*checkout.glob('LICENSE*'),*checkout.glob('NOTICE*'),*checkout.glob('COPYING*'),*checkout.glob('COPYRIGHT*')})
 if not files: raise SystemExit('Missing upstream license: '+identity)
 output.append('\n\n'+identity+'\n'+pin.get('location','')+'\nRevision: '+revision+'\n')
 for file in files:
  if file.is_file(): output.append('\n'+file.name+'\n'+file.read_text())
pathlib.Path('work/ios/native-notices.txt').write_text('\n'.join(output))
print('Retained licenses for',len(pins),'resolved packages.')
