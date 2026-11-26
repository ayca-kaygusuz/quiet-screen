Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

Var RestartAfterUpdate
Var RunningWindow


Name "Quiet Screen"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Quiet Screen"
InstallDirRegKey HKCU "Software\QuietScreen" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Quiet Screen"
VIAddVersionKey /LANG=1033 "FileDescription" "Quiet Screen installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Quiet Screen contributors"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Quiet Screen.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Quiet Screen"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function CheckInstallDirectory
  IfFileExists "$INSTDIR\quiet-screen.install" allowed
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  ${IfNot} ${Errors}
    check_next:
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Choose an empty folder or an existing Quiet Screen installation folder."
      Abort
    ${EndIf}
    ClearErrors
    FindNext $0 $1
    ${IfNot} ${Errors}
      Goto check_next
    ${EndIf}
    FindClose $0
  ${EndIf}
  allowed:
FunctionEnd

Function CloseRunningApplication
  check_running:
  FindWindow $RunningWindow "Chrome_WidgetWin_1" "Quiet Screen"
  ${If} $RunningWindow == 0
    Return
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Quiet Screen is running. Close it and continue installing? It will reopen when installation finishes. Save any unfinished entries before continuing." /SD IDNO IDYES close_application
  Abort
  close_application:
  System::Call 'user32::GetWindowThreadProcessId(p $RunningWindow, *i .r0)'
  System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i r0) p.r1'
  ${If} $1 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Quiet Screen could not be accessed. Close it yourself, then choose Retry." /SD IDCANCEL IDRETRY check_running
    Abort
  ${EndIf}
  ; WM_CLOSE lets Electron finish its normal shutdown and flush saved data.
  System::Call 'user32::PostMessageW(p $RunningWindow, i 0x0010, p 0, p 0)'
  System::Call 'kernel32::WaitForSingleObject(p r1, i 30000) i.r2'
  System::Call 'kernel32::CloseHandle(p r1)'
  ${If} $2 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Quiet Screen is still closing. Close any open dialogs, then choose Retry." /SD IDCANCEL IDRETRY check_running
    Abort
  ${EndIf}
  StrCpy $RestartAfterUpdate 1
  Goto check_running
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This installer needs 64-bit Windows."
    Abort
  ${EndIf}
  SetShellVarContext current
  StrCpy $RestartAfterUpdate 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} "$0" "/RESTARTAPP" $1
  ${IfNot} ${Errors}
    StrCpy $RestartAfterUpdate 1
  ${EndIf}
  ClearErrors
  ${GetOptions} "$0" "/UPDATEPID=" $1
  ${IfNot} ${Errors}
    ; The app launches this installer before quitting. Wait for that exact process.
    ${If} $1 > 0
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i r1) p.r2'
      ${If} $2 != 0
        System::Call 'kernel32::WaitForSingleObject(p r2, i 30000) i.r3'
        System::Call 'kernel32::CloseHandle(p r2)'
        ${If} $3 != 0
          MessageBox MB_OK|MB_ICONEXCLAMATION "Quiet Screen is still closing. Please try the update again." /SD IDOK
          Abort
        ${EndIf}
        Sleep 1000
      ${EndIf}
    ${EndIf}
  ${EndIf}

FunctionEnd

Function .onInstSuccess
  ${If} $RestartAfterUpdate == 1
    IfSilent 0 done_restarting
    Exec '"$INSTDIR\Quiet Screen.exe"'
  ${EndIf}
  done_restarting:
FunctionEnd

Section "Install"
  Call CheckInstallDirectory
  Call CloseRunningApplication
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"
  FileOpen $0 "$INSTDIR\quiet-screen.install" w
  FileWrite $0 "com.quietscreen.desktop"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall Quiet Screen.exe"
  CreateDirectory "$SMPROGRAMS\Quiet Screen"
  CreateShortcut "$SMPROGRAMS\Quiet Screen\Quiet Screen.lnk" "$INSTDIR\Quiet Screen.exe"
  CreateShortcut "$DESKTOP\Quiet Screen.lnk" "$INSTDIR\Quiet Screen.exe"
  WriteRegStr HKCU "Software\QuietScreen" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "DisplayName" "Quiet Screen"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "Publisher" "Quiet Screen contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "DisplayIcon" "$INSTDIR\Quiet Screen.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "UninstallString" '$\"$INSTDIR\Uninstall Quiet Screen.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "QuietUninstallString" '$\"$INSTDIR\Uninstall Quiet Screen.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  FindWindow $0 "Chrome_WidgetWin_1" "Quiet Screen"
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONINFORMATION "Close Quiet Screen, then uninstall it again."
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Quiet Screen.lnk"
  Delete "$SMPROGRAMS\Quiet Screen\Quiet Screen.lnk"
  RMDir "$SMPROGRAMS\Quiet Screen"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QuietScreen"
  DeleteRegKey HKCU "Software\QuietScreen"
  ; Remove application binaries only. The separate app-data profile is preserved.
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\quiet-screen.install"
  Delete "$INSTDIR\Uninstall Quiet Screen.exe"
  RMDir "$INSTDIR"
SectionEnd
