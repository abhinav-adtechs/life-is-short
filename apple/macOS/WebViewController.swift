import AppKit
import AuthenticationServices
import LifeIsShortCore

/// The planner filling the window. The window and its title bar take the page's colour, so the traffic lights sit on
/// Tide, Night train or Day train rather than a grey bar.
final class WebViewController: NSViewController, WebHost {
    private(set) var controller: WebController!
    private static let zoomKey = "LISPageZoom"

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 820))
        root.wantsLayer = true
        root.layer?.backgroundColor = (NSColor(named: "LaunchBackground") ?? .windowBackgroundColor).cgColor
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        controller = WebController(host: self)
        let web = controller.webView
        // Hidden until the page paints, so there's no white flash.
        web.alphaValue = 0
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        let zoom = UserDefaults.standard.double(forKey: Self.zoomKey)
        if zoom > 0 { web.pageZoom = CGFloat(zoom) }
        controller.start()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        // Keys go to the planner straight away: ⌘K, E, Enter, Delete, Esc.
        view.window?.makeFirstResponder(controller.webView)
    }

    /// View → Zoom In, Zoom Out (a step) and Actual Size (nil). Kept for next time.
    func zoom(by step: CGFloat?) {
        let web = controller.webView
        let next: CGFloat = step.map { min(max(web.pageZoom + $0, 0.5), 2) } ?? 1
        web.pageZoom = next
        UserDefaults.standard.set(Double(next), forKey: Self.zoomKey)
    }

    // MARK: - WebHost

    var hostWindow: ASPresentationAnchor? { view.window }

    func pageBackgroundChanged(_ color: RGBA) {
        let background = NSColor(srgbRed: color.red, green: color.green, blue: color.blue, alpha: 1)
        view.layer?.backgroundColor = background.cgColor
        view.window?.backgroundColor = background
    }

    func pageDidAppear() {
        let web = controller.webView
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            web.animator().alphaValue = 1
        }
    }

    func share(title: String?, text: String?, url: URL?, completion: @escaping (Bool) -> Void) {
        var items: [Any] = []
        if let url { items.append(url) }
        if let text { items.append(text) } else if url == nil, let title { items.append(title) }
        // Near the top right, where the planner's Share panel opens.
        let anchor = NSRect(x: view.bounds.maxX - 240, y: view.bounds.maxY - 120, width: 1, height: 1)
        NSSharingServicePicker(items: items).show(relativeTo: anchor, of: view, preferredEdge: .minY)
        completion(true)
    }

    func haptic(_ kind: Haptic) {
        // Only Force Touch trackpads have anything to give, and only a light touch suits a desk.
        guard kind == .success || kind == .selection else { return }
        NSHapticFeedbackManager.defaultPerformer.perform(kind == .success ? .levelChange : .alignment, performanceTime: .now)
    }
}
