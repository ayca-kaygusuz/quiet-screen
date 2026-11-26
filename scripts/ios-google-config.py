# Copyright 2026 Alex (Ayca Kaygusuz)
# SPDX-License-Identifier: Apache-2.0
"""Extract only public iOS configuration; never copy the downloaded plist into the app."""
import os,plistlib,re
public=os.environ.get('QUIET_SCREEN_GOOGLE_IOS_CLIENT_ID','').strip()
# Existing Actions entry created by the maintainer; its name predates clarification
# that Google's iOS plist contains configuration rather than an OAuth client secret.
raw=os.environ.get('QUIET_SCREEN_GOOGLE_IOS_CONFIGURATION','').strip()
if raw:
 if len(raw)>65536:raise SystemExit('iOS Google configuration is too large.')
 try:config=plistlib.loads(raw.encode())
 except Exception:raise SystemExit('The saved iOS configuration must be Google’s downloaded XML plist.')
 candidate=config.get('CLIENT_ID','')
 if public and candidate!=public:raise SystemExit('The iOS plist belongs to a different public client ID.')
 if config.get('BUNDLE_ID','com.quietscreen.ios')!='com.quietscreen.ios':raise SystemExit('The iOS client must use com.quietscreen.ios.')
 public=public or candidate
if not public and not raw:
 print('Native Google sign-in is unconfigured; guest mode remains available.')
 raise SystemExit(0)
if not re.fullmatch(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',public):raise SystemExit('Supply the public iOS client ID or its downloaded plist for this native build.')
with open(os.environ['GITHUB_ENV'],'a') as output:output.write('QUIET_SCREEN_GOOGLE_IOS_CLIENT_ID='+public+'\n')
print('Configured the public iOS client ID. No OAuth secret, plist or API key is bundled.')
