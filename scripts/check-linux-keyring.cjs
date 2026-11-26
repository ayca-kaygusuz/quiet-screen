// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
const {app,safeStorage}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
app.setName('Quiet Screen Linux Keyring Check');
app.whenReady().then(()=>{
 assert(safeStorage.isEncryptionAvailable(),'The Linux keyring is not available.');
 assert(['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(safeStorage.getSelectedStorageBackend()),'No secure Linux keyring was selected.');
 const value='quiet-screen-ephemeral-keyring-probe',path=process.env.QUIET_SCREEN_KEYRING_PROBE;
 assert(path,'An isolated probe file is required.');
 if(process.env.QUIET_SCREEN_KEYRING_MODE==='read')assert.equal(safeStorage.decryptString(readFileSync(path)),value);
 else{const bytes=safeStorage.encryptString(value);assert(!bytes.includes(Buffer.from(value)));writeFileSync(path,bytes,{mode:0o600})}
 console.log('PASS: Linux OS keyring '+(process.env.QUIET_SCREEN_KEYRING_MODE==='read'?'restored an encrypted test value after restart.':'encrypted a test value without plaintext storage.'));
 app.quit();
}).catch(error=>{console.error(error.message);app.exit(1)});
