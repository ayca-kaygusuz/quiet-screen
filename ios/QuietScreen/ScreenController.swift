// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import UIKit
import WebKit
import Network
import UniformTypeIdentifiers
import GoogleSignIn

final class ScreenController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate {
    private var web: WKWebView!
    private let network = NWPathMonitor()
    private var online = false, metered = false, pending = false, tokenRejected = false
    private var account: [String: String]? = UserDefaults.standard.dictionary(forKey: "google.publicAccount") as? [String: String]
    private var accountError = "", generation = 0
    private var requests: [Int: BoundedRequest] = [:]
    private var inFlight = Set<Int>()
    private var fileReply: ((Any?, String?) -> Void)?
    private var exportURL: URL?, exporting = false, light = false
    private let driveScope = "https://www.googleapis.com/auth/drive.appdata"
    private var clientID: String { Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String ?? "" }
    override var preferredStatusBarStyle: UIStatusBarStyle { light ? .darkContent : .lightContent }
    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(Assets(), forURLScheme: Assets.scheme)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.addScriptMessageHandler(WeakBridge(self), contentWorld: .page, name: "QuietScreenNative")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        web.isOpaque = false; web.backgroundColor = UIColor(red: 23/255, green: 24/255, blue: 29/255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor; view.backgroundColor = web.backgroundColor
        web.translatesAutoresizingMaskIntoConstraints = false
        web.accessibilityIdentifier = "libraryWebView"
        view.addSubview(web)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)])
        network.pathUpdateHandler = { [weak self] path in DispatchQueue.main.async { self?.online = path.status == .satisfied; self?.metered = path.isExpensive || path.isConstrained; self?.refresh() } }
        network.start(queue: DispatchQueue(label: "quiet-screen.connection"))
        if !clientID.isEmpty {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            let started = generation
            GIDSignIn.sharedInstance.restorePreviousSignIn { [weak self] user, error in
                guard let self, self.generation == started else { return }
                if let user, self.identity(user) != nil { self.remember(user) }
                else if self.account != nil { self.accountError = "Reconnect Google when online. Your library remains on this device." }
                self.refresh()
            }
        }
        web.load(URLRequest(url: URL(string: Assets.origin + "/")!))
    }
    deinit { network.cancel() }
    func refresh() {
        guard isViewLoaded else { return }
        web.evaluateJavaScript("globalThis.QuietScreenAccount?.refresh();globalThis.QuietScreenUpdates?.connectionChanged();", completionHandler: nil)
    }
    private func identity(_ user: GIDGoogleUser) -> [String: String]? {
        guard let id = user.userID, id.range(of: "^[0-9]{1,100}$", options: .regularExpression) != nil, let profile = user.profile, profile.email.count <= 320 else { return nil }
        return ["id": id, "email": profile.email, "name": String(profile.name.prefix(200))]
    }
    private func remember(_ user: GIDGoogleUser) {
        guard let value = identity(user), user.grantedScopes?.contains(driveScope) == true else { accountError = "Google Drive app-data permission is required for sync."; return }
        account = value; tokenRejected = false; accountError = ""
        UserDefaults.standard.set(value, forKey: "google.publicAccount")
    }
    private func status() -> [String: Any] {
        ["mode": "ios", "configured": !clientID.isEmpty, "account": account as Any? ?? NSNull(), "pending": pending, "rememberSupported": true, "network": ["online": online, "metered": metered, "source": "iOS/iPadOS"], "error": accountError]
    }
    private func signIn() {
        guard !pending, !clientID.isEmpty else { return }
        pending = true; generation += 1; accountError = ""
        let started = generation
        GIDSignIn.sharedInstance.signIn(withPresenting: self, hint: nil, additionalScopes: [driveScope]) { [weak self] result, error in
            guard let self else { return }
            guard started == self.generation else { if self.account == nil { GIDSignIn.sharedInstance.signOut() }; return }
            self.pending = false
            if let user = result?.user { self.remember(user) }
            else { self.accountError = "Sign-in was cancelled or could not finish. Your local library is unchanged." }
            self.refresh()
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, Assets.local(message.frameInfo.request.url), Assets.local(web.url), let request = message.body as? [String: Any], let id = request["id"] as? Int, id > 0, let method = request["method"] as? String, let args = request["parameters"] as? [String: Any] else { replyHandler(nil, "Blocked request"); return }
        switch method {
        case "asset.read":
            guard let name = args["name"] as? String, Assets.names.contains(name), let root = Bundle.main.resourceURL?.appendingPathComponent("Web"), let text = try? String(contentsOf: root.appendingPathComponent(name), encoding: .utf8) else { replyHandler(nil,"Blocked asset request"); return }
            replyHandler(text,nil)
        case "app.info": replyHandler(["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"], nil)
        case "app.appearance":
            guard let hex = args["color"] as? String, hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, let rgb = UInt32(hex.dropFirst(), radix: 16) else { replyHandler(nil, "Invalid appearance"); return }
            let color = UIColor(red: CGFloat((rgb >> 16) & 255)/255, green: CGFloat((rgb >> 8) & 255)/255, blue: CGFloat(rgb & 255)/255, alpha: 1)
            view.backgroundColor = color; web.backgroundColor = color; web.scrollView.backgroundColor = color
            light = args["light"] as? Bool == true; overrideUserInterfaceStyle = light ? .light : .dark; setNeedsStatusBarAppearanceUpdate(); replyHandler(true, nil)
        case "account.status": replyHandler(status(), nil)
        case "account.start": signIn(); replyHandler(status(), nil)
        case "account.cancel": generation += 1; pending = false; replyHandler(status(), nil)
        case "account.signout":
            generation += 1; pending = false; account = nil; accountError = ""; tokenRejected = false
            requests.values.forEach { $0.cancel() }; inFlight.removeAll(); GIDSignIn.sharedInstance.signOut()
            UserDefaults.standard.removeObject(forKey: "google.publicAccount"); replyHandler(status(), nil)
        case "account.clearToken": tokenRejected = true; replyHandler(true, nil)
        case "http.cancel": if let target = args["requestId"] as? Int { requests[target]?.cancel(); inFlight.remove(target) }; replyHandler(true, nil)
        case "http": http(args, id: id, reply: replyHandler)
        case "backup.save", "backup.open": pickBackup(method, args: args, reply: replyHandler)
        case "open.external":
            guard let text = args["url"] as? String, let url = URL(string: text), NetworkPolicy.external(url) else { replyHandler(nil, "This link cannot be opened by Quiet Screen."); return }
            UIApplication.shared.open(url, options: [:]) { opened in replyHandler(opened, nil) }
        default: replyHandler(nil, "Unsupported iOS request")
        }
    }
    private func http(_ args: [String: Any], id: Int, reply: @escaping (Any?, String?) -> Void) {
        guard inFlight.count < 32, !inFlight.contains(id), let text = args["url"] as? String, text.count <= 16384, let url = URL(string: text), let method = args["method"] as? String, NetworkPolicy.allowed(url, method: method) else { reply(nil, "Blocked network request"); return }
        let drive = NetworkPolicy.drive(url), expected = args["accountId"] as? String ?? ""
        let headers = (args["headers"] as? [String: String] ?? [:]).reduce(into: [String: String]()) { $0[$1.key.lowercased()] = $1.value }
        guard !drive || headers["authorization"] == "Bearer native-account" && account?["id"] == expected && !tokenRejected else { reply(nil, "SIGN_IN_REQUIRED"); return }
        let body = args["body"] as? String ?? ""
        guard body.utf8.count <= NetworkPolicy.limit else { reply(nil, "Request too large"); return }
        var request = URLRequest(url: url); request.httpMethod = method
        for (name, value) in headers {
            if ["accept", "content-type", "user-agent"].contains(name) || name == "x-goog-api-key" && url.host == "www.googleapis.com" && url.path.hasPrefix("/books/v1/volumes") { request.setValue(value, forHTTPHeaderField: name) }
        }
        if !body.isEmpty { request.httpBody = Data(body.utf8) }
        inFlight.insert(id)
        let send: (String?) -> Void = { [weak self] token in
            guard let self else { reply(nil, "Request cancelled"); return }
            guard self.inFlight.contains(id) else { reply(nil, "Request cancelled"); return }
            guard !drive || self.account?["id"] == expected && token != nil else { self.inFlight.remove(id); reply(nil, "SIGN_IN_REQUIRED"); return }
            var outgoing = request
            if let token { outgoing.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
            self.requests[id] = BoundedRequest(request: outgoing) { [weak self] result in
                guard let self else { reply(nil, "Request cancelled"); return }; self.requests.removeValue(forKey: id); self.inFlight.remove(id)
                guard !drive || self.account?["id"] == expected else { reply(nil, "SIGN_IN_REQUIRED"); return }
                switch result { case .success(let value): reply(value, nil); case .failure: reply(nil, "The connection could not be completed. Your local library is kept.") }
            }
        }
        if drive {
            guard let user = GIDSignIn.sharedInstance.currentUser, user.userID == expected, user.grantedScopes?.contains(driveScope) == true else { inFlight.remove(id); reply(nil, "SIGN_IN_REQUIRED"); return }
            user.refreshTokensIfNeeded { [weak self] refreshed, error in
                guard let self, error == nil, let refreshed, refreshed.userID == expected, self.account?["id"] == expected else { self?.inFlight.remove(id); reply(nil, "SIGN_IN_REQUIRED"); return }
                send(refreshed.accessToken.tokenString)
            }
        } else { send(nil) }
    }
    private func pickBackup(_ method: String, args: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard fileReply == nil, presentedViewController == nil else { reply(nil, "Finish the current dialog first."); return }
        let picker: UIDocumentPickerViewController
        exporting = method == "backup.save"
        if exporting {
            guard let document = args["document"] as? [String: Any], JSONSerialization.isValidJSONObject(document), let bytes = try? JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys]), bytes.count <= NetworkPolicy.limit else { reply(nil, "This backup could not be saved."); return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let url = directory.appendingPathComponent("Quiet-Screen-backup.json")
            do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); try bytes.write(to: url, options: .atomic) } catch { reply(nil, "This backup could not be saved."); return }
            exportURL = url; picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        } else { picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true) }
        fileReply = reply; picker.delegate = self; picker.allowsMultipleSelection = false
        picker.modalPresentationStyle = .formSheet
        present(picker, animated: true)
    }
    private func finishFile(_ value: Any?, error: String? = nil) {
        let reply = fileReply; fileReply = nil
        if let exportURL { try? FileManager.default.removeItem(at: exportURL.deletingLastPathComponent()) }; exportURL = nil
        reply?(value, error)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let value: Any = exporting ? false : NSNull()
        controller.dismiss(animated: true) { self.finishFile(value) }
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if exporting { controller.dismiss(animated: true) { self.finishFile(true) }; return }
        guard let url = urls.first else { controller.dismiss(animated: true) { self.finishFile(NSNull()) }; return }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? NetworkPolicy.limit + 1
            guard size <= NetworkPolicy.limit else { throw URLError(.dataLengthExceedsMaximum) }
            let bytes = try Data(contentsOf: url); guard bytes.count <= NetworkPolicy.limit else { throw URLError(.dataLengthExceedsMaximum) }
            let document = try JSONSerialization.jsonObject(with: bytes)
            // Finish dismissal before JavaScript can present the restore confirmation.
            controller.dismiss(animated: true) { self.finishFile(document) }
        } catch { controller.dismiss(animated: true) { self.finishFile(nil, error: "This JSON backup could not be read. Your current library is unchanged.") } }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if Assets.local(url), ["", "/", "/index.html"].contains(url?.path ?? "") { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, let url, NetworkPolicy.external(url) { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, NetworkPolicy.external(url) { UIApplication.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Quiet Screen", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Quiet Screen", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    override var keyCommands: [UIKeyCommand]? {
        let add = UIKeyCommand(input: "n", modifierFlags: .command, action: #selector(addTitle)); add.discoverabilityTitle = "Add title"
        let search = UIKeyCommand(input: "f", modifierFlags: .command, action: #selector(searchLibrary)); search.discoverabilityTitle = "Search library"
        let back = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(back)); back.discoverabilityTitle = "Back to library"
        return [add, search, back]
    }
    @objc private func addTitle() { web.evaluateJavaScript("document.querySelector('#add').click()", completionHandler: nil) }
    @objc private func searchLibrary() { web.evaluateJavaScript("document.querySelector('#search').focus()", completionHandler: nil) }
    @objc private func back() { web.evaluateJavaScript("globalThis.QuietScreenIOS?.back()", completionHandler: nil) }
}

private final class WeakBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: ScreenController?
    init(_ target: ScreenController) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let target else { replyHandler(nil, "App closed"); return }
        target.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}
