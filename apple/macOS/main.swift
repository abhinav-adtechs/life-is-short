import AppKit

// The Mac app has no storyboard: make the application, give it its delegate, and run.
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
