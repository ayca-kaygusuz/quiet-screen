// Copyright 2026 Alex (Ayca Kaygusuz)
// SPDX-License-Identifier: Apache-2.0
import UIKit
import GoogleSignIn

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Library", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }
}
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = ScreenController()
        self.window = window
        window.makeKeyAndVisible()
        for item in options.urlContexts { _ = GIDSignIn.sharedInstance.handle(item.url) }
    }
    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        for item in contexts { _ = GIDSignIn.sharedInstance.handle(item.url) }
    }
    func sceneDidBecomeActive(_ scene: UIScene) { (window?.rootViewController as? ScreenController)?.refresh() }
}
