// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import XCTest
import UIKit
import WebKit
@testable import QuietScreen

final class RuntimeTests: XCTestCase {
    @MainActor private func evaluate(_ script: String, in web: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            web.evaluateJavaScript(script) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }
    @MainActor private func asyncScript(_ script: String, in web: WKWebView) async throws -> Any? {
        // Use the same callback evaluator as the application. Some older Apple
        // simulator runtimes omit the separate Swift WebKit overlay library.
        let key = UUID().uuidString
        let launch = "globalThis.__quietScreenTestPromises ??= {}; (async()=>{\n" + script + "\n})().then(value=>globalThis.__quietScreenTestPromises['" + key + "']={value:value??null},error=>globalThis.__quietScreenTestPromises['" + key + "']={error:String(error.message||error)}); true"
        _ = try await evaluate(launch, in: web)
        for _ in 0..<100 {
            if let result = try await evaluate("globalThis.__quietScreenTestPromises['" + key + "']||null", in: web) as? [String: Any] {
                _ = try await evaluate("delete globalThis.__quietScreenTestPromises['" + key + "']", in: web)
                if let message = result["error"] as? String { throw NSError(domain: "JavaScript", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
                return result["value"]
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "JavaScript", code: 2, userInfo: [NSLocalizedDescriptionKey: "Async test script did not finish"])
    }
    @MainActor private func ready() async throws -> WKWebView {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let controller = try XCTUnwrap(scene.windows.first?.rootViewController as? ScreenController)
        let web = try XCTUnwrap(controller.view.subviews.first as? WKWebView)
        for _ in 0..<150 {
            if (try? await evaluate("!!globalThis.QuietScreenApp && !!globalThis.QuietScreenIOS && !!globalThis.QuietScreenAccount && document.documentElement.dataset.platform==='ios'", in: web)) as? Bool == true { return web }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "Runtime", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared interface did not load in WKWebView"])
    }
    @MainActor func testSharedStorageAndNativeBoundaries() async throws {
        let web = try await ready()
        let platform = try await evaluate("document.documentElement.dataset.platform", in:web) as? String
        XCTAssertEqual(platform,"ios")
        let ok = try await evaluate("(()=>{QuietScreenApp.apply({library:[{id:'ios-test',title:'iOS movie',format:'Movie',year:'',imdb:'',episodic:false,active:null,history:[],episodes:[],seasons:[]}],lists:[],preferences:{theme:'sage'}});QuietScreenApp.changed?.();return QuietScreenApp.snapshot().library.length===1&&document.documentElement.dataset.theme==='sage'})()",in:web) as? Bool
        XCTAssertEqual(ok,true)
        let status = try await asyncScript("return await (await fetch('/api/account/status')).json()",in:web) as? [String:Any]
        XCTAssertEqual(status?["mode"] as? String,"ios")
        let backup = try await evaluate("QuietScreenApp.backupDocument(QuietScreenApp.snapshot()).version",in:web) as? Int
        XCTAssertEqual(backup,1)
        let width = try await evaluate("document.documentElement.scrollWidth<=innerWidth",in:web) as? Bool
        XCTAssertEqual(width,true)
        XCTAssertFalse(NetworkPolicy.allowed(URL(string:"http://example.com")!,method:"GET"))
        XCTAssertFalse(NetworkPolicy.allowed(URL(string:"https://example.com")!,method:"GET"))
        XCTAssertTrue(NetworkPolicy.allowed(URL(string:"https://v3.sg.media-imdb.com/suggestion/x/test.json")!,method:"GET"))
        XCTAssertFalse(NetworkPolicy.allowed(URL(string:"https://www.googleapis.com/drive/v3/files")!,method:"PUT"))
    }
}
