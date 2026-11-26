# Copyright 2026 Alex (Ayca Kaygusuz)
# SPDX-License-Identifier: Apache-2.0
"""Generate the small universal UIKit project using only the Python standard library."""
from pathlib import Path
import hashlib

def ident(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
objects = []
def obj(name, body):
    key = ident(name); objects.append(f'{key} /* {name} */ = {{ {body} }};'); return key

def array(items): return '(' + ', '.join(items) + (',' if items else '') + ')'
def settings(values): return '{' + ' '.join(f'{k} = {v};' for k,v in values.items()) + '}'

sources = ['App.swift','Assets.swift','NetworkPolicy.swift','ScreenController.swift']
files = []
for source in sources:
    ref = obj('file-'+source, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {source}; sourceTree = "<group>";')
    files.append(ref)
refs = {s:ident('file-'+s) for s in sources}
for name,kind in [('Web','folder'),('Assets.xcassets','folder.assetcatalog'),('PrivacyInfo.xcprivacy','text.xml'),('Info.plist','text.plist.xml')]:
    files.append(obj('file-'+name, f'isa = PBXFileReference; lastKnownFileType = {kind}; path = {name}; sourceTree = "<group>";'))
mainGroup = obj('AppGroup',f'isa = PBXGroup; children = {array(files)}; path = QuietScreen; sourceTree = "<group>";')
unit = obj('UnitFile','isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RuntimeTests.swift; sourceTree = "<group>";')
ui = obj('UIFile','isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = TabletTests.swift; sourceTree = "<group>";')
unitGroup = obj('UnitGroup', f'isa = PBXGroup; children = {array([unit])}; path = QuietScreenTests; sourceTree = "<group>";')
uiGroup = obj('UIGroup', f'isa = PBXGroup; children = {array([ui])}; path = QuietScreenUITests; sourceTree = "<group>";')
products = []
for name,ext,kind in [('QuietScreen','app','wrapper.application'),('QuietScreenTests','xctest','wrapper.cfbundle'),('QuietScreenUITests','xctest','wrapper.cfbundle')]:
    products.append(obj(name+'-product',f'isa = PBXFileReference; explicitFileType = {kind}; includeInIndex = 0; path = {name}.{ext}; sourceTree = BUILT_PRODUCTS_DIR;'))
productsGroup = obj('Products',f'isa = PBXGroup; children = {array(products)}; name = Products; sourceTree = "<group>";')
root = obj('Root',f'isa = PBXGroup; children = {array([mainGroup,unitGroup,uiGroup,productsGroup])}; sourceTree = "<group>";')
package = obj('GoogleSignInPackage','isa = XCRemoteSwiftPackageReference; repositoryURL = "https://github.com/google/GoogleSignIn-iOS"; requirement = {kind = exactVersion; version = 10.1.0;};')
packageProduct = obj('GoogleSignInProduct',f'isa = XCSwiftPackageProductDependency; package = {package}; productName = GoogleSignIn;')
framework = obj('GoogleSignInBuild',f'isa = PBXBuildFile; productRef = {packageProduct};')
targets=[]
for i,name in enumerate(['QuietScreen','QuietScreenTests','QuietScreenUITests']):
    src = [obj(name+'-build-'+s,f'isa = PBXBuildFile; fileRef = {refs[s]};') for s in sources] if i==0 else [obj(name+'-build-test',f'isa = PBXBuildFile; fileRef = {unit if i==1 else ui};')]
    srcPhase = obj(name+'-sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {array(src)}; runOnlyForDeploymentPostprocessing = 0;')
    frameworks = obj(name+'-frameworks',f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = {array([framework] if i==0 else [])}; runOnlyForDeploymentPostprocessing = 0;')
    resources = [obj('resource-'+s,f'isa = PBXBuildFile; fileRef = {ident("file-"+s)};') for s in ['Web','Assets.xcassets','PrivacyInfo.xcprivacy']] if i==0 else []
    resPhase = obj(name+'-resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = {array(resources)}; runOnlyForDeploymentPostprocessing = 0;')
    configs=[]
    for config in ['Debug','Release']:
        vals={'PRODUCT_NAME':'"$(TARGET_NAME)"','PRODUCT_BUNDLE_IDENTIFIER':f'com.quietscreen.{"ios" if i==0 else name.lower()}','SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.4','TARGETED_DEVICE_FAMILY':'"1,2"','SUPPORTED_PLATFORMS':'"iphoneos iphonesimulator"','SUPPORTS_MACCATALYST':'NO','CODE_SIGN_STYLE':'Automatic','SWIFT_STRICT_CONCURRENCY':'targeted','ENABLE_USER_SCRIPT_SANDBOXING':'YES','LD_RUNPATH_SEARCH_PATHS':'"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"','GENERATE_INFOPLIST_FILE':'NO' if i==0 else 'YES'}
        if i==0: vals.update({'INFOPLIST_FILE':'QuietScreen/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES':'YES','MARKETING_VERSION':'0.21.1','CURRENT_PROJECT_VERSION':'1.21.1','QUIET_SCREEN_IOS_CLIENT_ID':'""','QUIET_SCREEN_IOS_REVERSED_CLIENT_ID':'"com.quietscreen.ios.signin-unconfigured"'})
        if i==1: vals.update({'TEST_HOST':'"$(BUILT_PRODUCTS_DIR)/QuietScreen.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/QuietScreen"','BUNDLE_LOADER':'"$(TEST_HOST)"'})
        if i==2: vals.update({'TEST_TARGET_NAME':'QuietScreen'})
        if config=='Debug': vals.update({'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG','SWIFT_OPTIMIZATION_LEVEL':'"-Onone"','ENABLE_TESTABILITY':'YES','ONLY_ACTIVE_ARCH':'YES','GCC_OPTIMIZATION_LEVEL':'0','DEBUG_INFORMATION_FORMAT':'dwarf'})
        else: vals.update({'SWIFT_COMPILATION_MODE':'wholemodule','DEBUG_INFORMATION_FORMAT':'"dwarf-with-dsym"','SWIFT_OPTIMIZATION_LEVEL':'"-O"'})
        configs.append(obj(name+'-'+config,f'isa = XCBuildConfiguration; buildSettings = {settings(vals)}; name = {config};'))
    configList=obj(name+'-configs',f'isa = XCConfigurationList; buildConfigurations = {array(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
    deps=[]
    if i:
        proxy=obj(name+'-proxy',f'isa = PBXContainerItemProxy; containerPortal = {ident("Project")}; proxyType = 1; remoteGlobalIDString = {ident("QuietScreen-target")}; remoteInfo = QuietScreen;')
        deps=[obj(name+'-dep',f'isa = PBXTargetDependency; target = {ident("QuietScreen-target")}; targetProxy = {proxy};')]
    targets.append(obj(name+'-target',f'isa = PBXNativeTarget; buildConfigurationList = {configList}; buildPhases = {array([srcPhase,frameworks,resPhase])}; buildRules = (); dependencies = {array(deps)}; name = {name}; packageProductDependencies = {array([packageProduct] if i==0 else [])}; productName = {name}; productReference = {products[i]}; productType = "com.apple.product-type.{"application" if i==0 else "bundle.unit-test" if i==1 else "bundle.ui-testing"}";'))
configs=[]
for config in ['Debug','Release']:
    configs.append(obj('Project-'+config,f'isa = XCBuildConfiguration; buildSettings = {{ CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; SWIFT_VERSION = 5.0; IPHONEOS_DEPLOYMENT_TARGET = 17.4; }}; name = {config};'))
configList=obj('Project-configs',f'isa = XCConfigurationList; buildConfigurations = {array(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
obj('Project',f'isa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1640; }}; buildConfigurationList = {configList}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = {root}; packageReferences = {array([package])}; productRefGroup = {productsGroup}; projectDirPath = ""; projectRoot = ""; targets = {array(targets)};')
project=Path('ios/QuietScreen.xcodeproj');project.mkdir(exist_ok=True)
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(objects)+'\n}; rootObject = '+ident('Project')+'; }\n')
scheme=project/'xcshareddata/xcschemes';scheme.mkdir(parents=True,exist_ok=True)
def ref(name):return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident(name+"-target")}" BuildableName="{name}.{"app" if name=="QuietScreen" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:QuietScreen.xcodeproj"/>'
(scheme/'QuietScreen.xcscheme').write_text('<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="1640" version="1.7"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">'+ref('QuietScreen')+'</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>'+''.join('<TestableReference skipped="NO" parallelizable="NO">'+ref(n)+'</TestableReference>' for n in ['QuietScreenTests','QuietScreenUITests'])+'</Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">'+ref('QuietScreen')+'</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">'+ref('QuietScreen')+'</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n')
