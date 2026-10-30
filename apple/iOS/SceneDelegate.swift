import LifeIsShortCore
import UIKit

/// The app's window, and what arrives at it from outside: Home Screen quick actions and lifeisshort:// links.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private var planner: WebViewController? { window?.rootViewController as? WebViewController }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        if let item = connectionOptions.shortcutItem { perform(item) }
        for context in connectionOptions.urlContexts { open(context.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { open(context.url) }
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(perform(shortcutItem))
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        planner?.setActive(true)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        planner?.setActive(false)
    }

    @discardableResult
    private func perform(_ item: UIApplicationShortcutItem) -> Bool {
        guard let command = DeepLink.command(forShortcut: item.type) else { return false }
        CommandCenter.shared.post(command)
        return true
    }

    private func open(_ url: URL) {
        guard let command = DeepLink.command(from: url) else { return }
        CommandCenter.shared.post(command)
    }
}
