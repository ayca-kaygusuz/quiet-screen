import { writeFile } from 'node:fs/promises'
import { googleDesktopConfiguration } from '../sync/google-oauth.mjs'

try {
  const config = googleDesktopConfiguration({
    clientId: process.env.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_ID,
    credentialValue: process.env.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_SECRET,
  })
  await writeFile(new URL('../desktop/google-client.generated.json', import.meta.url), JSON.stringify(config), { mode: 0o600 })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
