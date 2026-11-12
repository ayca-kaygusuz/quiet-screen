import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , runtimePath, compilerPath] = process.argv
if (process.platform !== 'win32' || !runtimePath || !compilerPath) {
  throw new Error('Usage on Windows: node desktop/build.mjs <Electron Windows x64 distribution directory> <makensis.exe>')
}
const project = fileURLToPath(new URL('../', import.meta.url))
const runtime = resolve(runtimePath)
const compiler = resolve(compilerPath)
const { version } = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const output = join(project, 'work', 'windows')
await mkdir(output, { recursive: true })
const build = await mkdtemp(join(output, 'build-'))
const appDir = join(build, 'Quiet Screen')
const payload = join(appDir, 'resources', 'app')

await readFile(join(runtime, 'version'), 'utf8')
await cp(runtime, appDir, {
  recursive: true,
  filter: source => !['resources' + sep + 'default_app.asar', 'resources' + sep + 'app.asar', 'resources' + sep + 'app']
    .includes(relative(runtime, source)),
})
await rename(join(appDir, 'electron.exe'), join(appDir, 'Quiet Screen.exe'))
await mkdir(join(payload, 'desktop'), { recursive: true })
for (const name of ['package.json', 'index.html', 'style.css', 'app.mjs', 'app-response.mjs', 'library.mjs', 'LICENSE', 'NOTICE', 'sync', 'desktop/main.mjs', 'desktop/google-account.mjs']) {
  await cp(join(project, name), join(payload, name), { recursive: true })
}

const config = 'desktop/google-client.generated.json'
const configured = await access(join(project, config)).then(() => true, () => false)
if (configured) await cp(join(project, config), join(payload, config))

async function uninstallCommands(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const commands = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    const target = '$INSTDIR\\' + relative(appDir, path).replaceAll('$', () => '$$')
    if (entry.isDirectory()) commands.push(...await uninstallCommands(path), 'RMDir "' + target + '"')
    else commands.push('Delete "' + target + '"')
  }
  return commands
}

const uninstallFile = join(build, 'uninstall-files.nsh')
await writeFile(uninstallFile, (await uninstallCommands(appDir)).join('\r\n') + '\r\n')
const artifact = join(output, 'Quiet-Screen-Setup-' + version + '-x64.exe')
execFileSync(compiler, [
  '/V2', '/DAPP_DIR=' + appDir, '/DUNINSTALL_FILES=' + uninstallFile, '/DAPP_VERSION=' + version,
  '/DOUTPUT_FILE=' + artifact, join(project, 'desktop', 'installer.nsi'),
], { stdio: 'inherit', env: { ...process.env, NSISDIR: dirname(compiler) } })
const installer = await readFile(artifact)
if (installer.subarray(0, 2).toString() !== 'MZ') throw new Error('The installer is not a Windows executable.')
const sha = createHash('sha256').update(installer).digest('hex')
await writeFile(join(output, 'SHA256SUMS.txt'), sha + '  ' + relative(output, artifact) + '\n')
console.log('Windows installer: ' + artifact)
console.log('Unpacked Windows app: ' + join(appDir, 'Quiet Screen.exe'))
