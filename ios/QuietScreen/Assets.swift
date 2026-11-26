// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import WebKit

final class Assets: NSObject, WKURLSchemeHandler {
    static let scheme = "quiet-screen-ios"
    static let origin = "quiet-screen-ios://app"
    static let names: Set<String> = ["index.html", "style.css", "app.mjs", "library.mjs", "franchises.mjs", "franchise-lookup.mjs", "episode-releases.mjs", "catalogue.mjs", "releases.mjs", "update-ui.mjs", "sync/account.js", "sync/sync-core.js", "sync/drive.mjs", "mobile/bootstrap.js", "mobile/native-api.mjs", "mobile/mobile.css", "license.txt", "NOTICE", "THIRD_PARTY_NOTICES.md", "native-notices.txt"]
    static func local(_ url: URL?) -> Bool { url?.scheme == scheme && url?.host == "app" && url?.port == nil && url?.user == nil && url?.password == nil }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, Self.local(url) else { urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile)); return }
        let name = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
        guard Self.names.contains(name), urlSchemeTask.request.httpMethod == "GET", let root = Bundle.main.resourceURL?.appendingPathComponent("Web"), let data = try? Data(contentsOf: root.appendingPathComponent(name)) else { urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return }
        var headers = ["Content-Type": name.hasSuffix(".html") ? "text/html; charset=utf-8" : name.hasSuffix(".css") ? "text/css; charset=utf-8" : name.hasSuffix(".txt") || name.hasSuffix(".md") || name == "NOTICE" ? "text/plain; charset=utf-8" : "application/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*", "Referrer-Policy": "no-referrer"]
        if name == "index.html" { headers["Content-Security-Policy"] = try? String(contentsOf: root.appendingPathComponent("csp.txt"), encoding: .utf8) }
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
