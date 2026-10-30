import AuthenticationServices
import LifeIsShortCore
import UIKit

/// The planner, edge to edge. The status bar's text follows the page's colour, so Night train on a light phone still
/// reads, and the hardware keyboard gets the planner's shortcuts.
final class WebViewController: UIViewController, WebHost {
    private var controller: WebController!
    /// Whether the page behind the status bar is dark; nil until the page says.
    private var darkPage: Bool?

    override func loadView() {
        view = UIView()
        view.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        controller = WebController(host: self)
        let web = controller.webView
        // Hidden until the page paints, so there's no white flash.
        web.alpha = 0
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        controller.start()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        guard let darkPage else { return .default }
        return darkPage ? .lightContent : .darkContent
    }

    func setActive(_ active: Bool) {
        controller?.setActive(active)
    }

    // MARK: - WebHost

    var hostWindow: ASPresentationAnchor? { view.window }

    var presenter: UIViewController? { self }

    func pageBackgroundChanged(_ color: RGBA) {
        view.backgroundColor = UIColor(red: color.red, green: color.green, blue: color.blue, alpha: 1)
        guard darkPage != color.isDark else { return }
        darkPage = color.isDark
        setNeedsStatusBarAppearanceUpdate()
    }

    func pageDidAppear() {
        let web = controller.webView
        UIView.animate(withDuration: 0.2) { web.alpha = 1 }
    }

    func share(title: String?, text: String?, url: URL?, completion: @escaping (Bool) -> Void) {
        var items: [Any] = []
        if let url { items.append(url) }
        if let text { items.append(text) } else if url == nil, let title { items.append(title) }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, completed, _, _ in completion(completed) }
        if let popover = sheet.popoverPresentationController {
            // iPad: point at the middle of the bottom edge, where the planner's share buttons sit on a sheet.
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 120, width: 1, height: 1)
            popover.permittedArrowDirections = [.down, .up]
        }
        guard presentedViewController == nil else { return completion(false) }
        present(sheet, animated: true)
    }

    func haptic(_ kind: Haptic) {
        switch kind {
        case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .light: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .medium: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        }
    }

    // MARK: - Hardware keyboard (hold ⌘ on an iPad to see them)

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(title: "Dump a Thought", action: #selector(dumpThought), input: "k", modifierFlags: .command),
            UIKeyCommand(title: "Speak", action: #selector(speak), input: "k", modifierFlags: [.command, .shift]),
            UIKeyCommand(title: "Settings", action: #selector(openSettings), input: ",", modifierFlags: .command),
            UIKeyCommand(title: "Reload", action: #selector(reloadPlanner), input: "r", modifierFlags: .command),
        ]
    }

    @objc private func dumpThought() { controller.handle(.dump(text: nil)) }

    @objc private func speak() { controller.handle(.listen) }

    @objc private func openSettings() { controller.handle(.open(.settings)) }

    @objc private func reloadPlanner() { controller.reload() }
}
