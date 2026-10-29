import AppKit
import LifeIsShortCore

/// The Mac app: one window onto the planner, the menu bar, and lifeisshort:// links. Closing the window keeps the
/// planner running and signed in; the Dock icon or Window → Planner brings it back.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var planner: WebViewController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.mainMenu = MainMenu.build(for: self)

        planner = WebViewController()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Life is short"
        // The title bar takes the page's colour (WebViewController), with no title on it: the planner names itself.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(named: "LaunchBackground") ?? .windowBackgroundColor
        window.contentViewController = planner
        window.minSize = NSSize(width: 420, height: 560)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        if !window.setFrameUsingName("Main") { window.center() }
        window.setFrameAutosaveName("Main")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        showPlanner(nil)
        for url in urls {
            if let command = DeepLink.command(from: url) { CommandCenter.shared.post(command) }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showPlanner(nil) }
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        // Siri, Shortcuts and Spotlight open the app to hand it a command: make sure the planner is there to take it.
        if window?.isVisible == false && !NSApp.windows.contains(where: { $0.isVisible && $0.isKeyWindow }) { showPlanner(nil) }
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    // MARK: - Menu commands

    @objc func showPlanner(_ sender: Any?) {
        window?.makeKeyAndOrderFront(nil)
    }

    @objc func dumpThought(_ sender: Any?) { command(.dump(text: nil)) }

    @objc func speak(_ sender: Any?) { command(.listen) }

    @objc func openSettings(_ sender: Any?) { command(.open(.settings)) }

    @objc func openAnalytics(_ sender: Any?) { command(.open(.analytics)) }

    @objc func openReview(_ sender: Any?) { command(.open(.review)) }

    @objc func openShare(_ sender: Any?) { command(.open(.share)) }

    @objc func reloadPlanner(_ sender: Any?) { planner.controller.reload() }

    @objc func changeServer(_ sender: Any?) {
        showPlanner(nil)
        planner.controller.changeServer()
    }

    @objc func zoomIn(_ sender: Any?) { planner.zoom(by: 0.1) }

    @objc func zoomOut(_ sender: Any?) { planner.zoom(by: -0.1) }

    @objc func actualSize(_ sender: Any?) { planner.zoom(by: nil) }

    @objc func openHelp(_ sender: Any?) {
        // The planner's home page says what it does; without a server, the project's README does.
        let help = planner.controller.server ?? URL(string: "https://github.com/abhinav-adtechs/life-is-short#readme")!
        NSWorkspace.shared.open(help)
    }

    private func command(_ command: NativeCommand) {
        showPlanner(nil)
        planner.controller.handle(command)
    }
}
