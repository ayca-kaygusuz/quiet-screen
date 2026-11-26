param([Parameter(Mandatory=$true)][string]$Electron, [Parameter(Mandatory=$true)][string]$Compiler)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot
$testRoot = Join-Path $project ('work/installer-close-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$source = Get-Content -Raw (Join-Path $project 'desktop/installer.nsi')
$function = [regex]::Match($source, '(?s)Function CloseRunningApplication.*?FunctionEnd').Value
if (!$function) { throw 'Installer close function missing.' }
$function = $function.Replace('"Quiet Screen"', '"Quiet Screen installer fixture"')
Set-Content -Encoding utf8NoBOM (Join-Path $testRoot 'close.nsh') $function
$harness = @'
Unicode true
!include "LogicLib.nsh"
Name "Quiet Screen close test"
Caption "Quiet Screen close test"
OutFile "${TEST_EXE}"
RequestExecutionLevel user
Page instfiles
AutoCloseWindow true
Var RestartAfterUpdate
Var RunningWindow
!include "${CLOSE_INCLUDE}"
Section
  StrCpy $RestartAfterUpdate 0
  Call CloseRunningApplication
  FileOpen $0 "${RESULT_FILE}" w
  FileWrite $0 "$RestartAfterUpdate"
  FileClose $0
SectionEnd
'@
Set-Content -Encoding utf8NoBOM (Join-Path $testRoot 'test.nsi') $harness
$exe = Join-Path $testRoot 'close-test.exe'
$result = Join-Path $testRoot 'result.txt'
& $Compiler /V2 ("/DTEST_EXE=$exe") ("/DCLOSE_INCLUDE=" + (Join-Path $testRoot 'close.nsh')) ("/DRESULT_FILE=$result") (Join-Path $testRoot 'test.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Close harness failed to compile.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QuietScreenCloseTest {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string kind,string title);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window,int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
}
'@
$fixture = @'
import {app,BrowserWindow} from 'electron'
app.setPath('userData',process.argv.at(-1))
app.whenReady().then(()=>{
 const window=new BrowserWindow({title:'Quiet Screen installer fixture',show:false})
 window.on('page-title-updated',event=>event.preventDefault())
 window.loadURL('data:text/html,<title>Quiet Screen installer fixture</title>')
})
app.on('window-all-closed',()=>app.quit())
'@
$fixturePath = Join-Path $testRoot 'fixture.mjs'
Set-Content -Encoding utf8NoBOM $fixturePath $fixture
$running = $null
$installer = $null
try {
  $installer = Start-Process -FilePath $exe -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($installer.ExitCode -ne 0 -or (Get-Content -Raw $result) -ne '0') { throw 'Empty state failed.' }
  Remove-Item -LiteralPath $result
  $profile = Join-Path $testRoot 'profile'
  $running = Start-Process -FilePath $Electron -ArgumentList @('"' + $fixturePath + '"','"' + $profile + '"') -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $window = [QuietScreenCloseTest]::FindWindow('Chrome_WidgetWin_1','Quiet Screen installer fixture')
    if ($window -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($window -eq [IntPtr]::Zero) { throw 'Fixture window missing.' }
  $installer = Start-Process -FilePath $exe -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if (Test-Path -LiteralPath $result) { throw 'Silent installer continued with running app.' }
  if ($running.HasExited) { throw 'Silent installer closed app without consent.' }
  $installer = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $dialog = [QuietScreenCloseTest]::FindWindow('#32770','Quiet Screen close test')
    $yes = if ($dialog -ne [IntPtr]::Zero) { [QuietScreenCloseTest]::GetDlgItem($dialog,6) } else { [IntPtr]::Zero }
    if ($yes -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($yes -eq [IntPtr]::Zero) { throw 'Close consent prompt missing.' }
  [void][QuietScreenCloseTest]::PostMessage($yes,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
  $deadline = [DateTime]::UtcNow.AddSeconds(35)
  while (!(Test-Path -LiteralPath $result) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (!(Test-Path -LiteralPath $result) -or (Get-Content -Raw $result) -ne '1') { throw 'Close flow did not request restart.' }
  if (!$running.WaitForExit(5000)) { throw 'App failed to shut down gracefully.' }
  Write-Output 'PASS: empty state, silent decline, interactive consent, graceful exit, and restart request.'
} finally {
  if ($installer -and !$installer.HasExited) { $installer.Kill() }
  if ($running -and !$running.HasExited) { $running.Kill() }
}
