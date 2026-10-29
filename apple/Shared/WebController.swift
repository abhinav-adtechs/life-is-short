import AuthenticationServices
import Foundation
import LifeIsShortCore
import Network
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// What the platform's window does for the web view.
@MainActor
protocol WebHost: AnyObject {
    /// Where the sign-in sheet attaches.
    var hostWindow: ASPresentationAnchor? { get }
    #if os(iOS)
    /// Presents alerts and the share sheet.
    var presenter: UIViewController? { get }
    #endif
    /// The page's background changed: paint the status bar, title bar and window to match.
    func pageBackgroundChanged(_ color: RGBA)
    /// The first page has painted: time to show the web view.
    func pageDidAppear()
    func share(title: String?, text: String?, url: URL?, completion: @escaping (Bool) -> Void)
    func haptic(_ kind: Haptic)
}

/// The window's web view and everything around it: what may load, the bridge to the page, dictation, Google sign-in,
/// commands for the planner, and the app's own setup and offline page. Both apps share it.
@MainActor
final class WebController: NSObject {
    let webView: WKWebView
    private weak var host: WebHost?
    private(set) var server: URL?
    private var policy: NavigationPolicy
    /// The folder of the app's bundled setup and offline page.
    private static let pages = Bundle.main.resourceURL?.appendingPathComponent("Pages", isDirectory: true)
    private var speech: SpeechBridge!
    private let google = GoogleSignIn()
    private var smoke: SmokeTest?

    /// The app's own page, when that's what's showing.
    private enum LocalPage { case setup, offline(String) }
    private var local: LocalPage?
    /// The planner said `ready` since it last loaded: commands can go to it.
    private var plannerReady = false
    private var waiting: [NativeCommand] = []
    private var revealed = false
    private var lastExternal: (url: URL, at: Date)?
    private let network = NWPathMonitor()
    private var online = true

    init(host: WebHost) {
        let server = AppEnvironment.server
        self.host = host
        self.server = server
        policy = NavigationPolicy(server: server, localPages: Self.pages)
        webView = Self.makeWebView()
        super.init()

        speech = SpeechBridge { [weak self] id, event in self?.speechEvent(id, event) }
        webView.configuration.userContentController.addScriptMessageHandler(MessageRelay(self), contentWorld: .page, name: "lis")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if AppEnvironment.smokeTest { smoke = SmokeTest(controller: self) }
        watchNetwork()
        CommandCenter.shared.setHandler { [weak self] command in self?.handle(command) }
    }

    private static func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        #if os(iOS)
        config.applicationNameForUserAgent = "Mobile/15E148 LifeIsShort/\(AppEnvironment.version)"
        config.allowsInlineMediaPlayback = true
        config.dataDetectorTypes = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsLinkPreview = false
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // Edge to edge: the page keeps clear of the notch and home indicator with env(safe-area-inset-*).
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        #else
        config.applicationNameForUserAgent = "LifeIsShort/\(AppEnvironment.version)"
        let view = PlannerWebView(frame: .zero, configuration: config)
        #endif
        view.allowsBackForwardNavigationGestures = false
        view.isInspectable = AppEnvironment.isDebug
        return view
    }

    // MARK: - Loading

    /// The planner, or the setup page when there's no server yet.
    func start() {
        if let server { loadPlanner(server) } else { showLocal(.setup) }
        // Show the web view even if the page never reports its colour.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            self?.reveal()
        }
    }

    func reload() {
        if local != nil || webView.url == nil { start() } else { webView.reload() }
    }

    /// The setup page, to point the app at another server.
    func changeServer() {
        showLocal(.setup)
    }

    private func loadPlanner(_ server: URL) {
        local = nil
        plannerReady = false
        installBridge(page: nil)
        webView.load(URLRequest(url: server.appendingPathComponent("app")))
    }

    private func showLocal(_ page: LocalPage) {
        guard let pages = Self.pages else { return }
        local = page
        plannerReady = false
        var state: [String: Any] = [:]
        switch page {
        case .setup:
            state["mode"] = "setup"
        case .offline(let message):
            state["mode"] = "offline"
            state["message"] = message
        }
        if let server { state["server"] = ServerAddress.display(server) }
        installBridge(page: state)
        webView.loadFileURL(pages.appendingPathComponent("start.html"), allowingReadAccessTo: pages)
    }

    private static let bridgeSource: String? = Bundle.main.url(forResource: "Bridge", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    /// Bridge.js, called with this app's config, before the next page's own scripts.
    private func installBridge(page: [String: Any]?) {
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        var config: [String: Any] = [
            "platform": AppEnvironment.platform,
            "version": AppEnvironment.version,
            "build": AppEnvironment.build,
            "speech": SpeechBridge.isSupported(),
            "debug": AppEnvironment.isDebug || AppEnvironment.smokeTest,
        ]
        if let page { config["page"] = page }
        guard let source = Self.bridgeSource,
              let data = try? JSONSerialization.data(withJSONObject: config),
              let json = String(data: data, encoding: .utf8) else { return }
        content.addUserScript(WKUserScript(source: source + "(" + json + ");", injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    private func reveal() {
        guard !revealed else { return }
        revealed = true
        host?.pageDidAppear()
    }

    private func watchNetwork() {
        network.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.networkChanged(up) }
        }
        network.start(queue: DispatchQueue(label: "lifeisshort.network"))
    }

    private func networkChanged(_ up: Bool) {
        let was = online
        online = up
        if up, !was, case .offline? = local, let server { loadPlanner(server) }
    }

    // MARK: - Commands for the planner

    /// From Siri, a quick action, a link or the menu bar. They wait until the planner is up and unlocked.
    func handle(_ command: NativeCommand) {
        if case .googleCallback(let query) = command {
            if let server, let url = DeepLink.googleCallbackURL(server: server, query: query) { webView.load(URLRequest(url: url)) }
            return
        }
        waiting.append(command)
        flush()
    }

    private func flush() {
        guard plannerReady, local == nil, !waiting.isEmpty else { return }
        let commands = waiting
        waiting = []
        for command in commands {
            if let payload = command.payload { send(["kind": "command", "command": payload]) }
        }
    }

    private func send(_ message: [String: Any]) {
        webView.callAsyncJavaScript("window.lisNative && window.lisNative._receive(message)", arguments: ["message": message], in: nil, in: .page, completionHandler: nil)
    }

    private func speechEvent(_ id: String, _ event: [String: Any]) {
        var message = event
        message["kind"] = "speech"
        message["id"] = id
        send(message)
    }

    /// The app moved to or from the background.
    func setActive(_ active: Bool) {
        speech.isActive = active
    }

    // MARK: - Leaving the window

    func openExternally(_ url: URL) {
        // A link can reach both the navigation and the new-window delegate; open it once.
        if let last = lastExternal, last.url == url, Date().timeIntervalSince(last.at) < 1 { return }
        lastExternal = (url, Date())
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    private func signInWithGoogle(_ url: URL) {
        google.start(url, anchor: host?.hostWindow) { [weak self] callback in
            guard let self, let callback, let command = DeepLink.command(from: callback) else { return }
            self.handle(command)
        }
    }

    private func follow(_ decision: NavigationDecision, request: URLRequest) {
        switch decision {
        case .allow: webView.load(request)
        case .openExternally(let url): openExternally(url)
        case .signInWithGoogle(let url): signInWithGoogle(url)
        case .deepLink(let url): if let command = DeepLink.command(from: url) { handle(command) }
        case .cancel: break
        }
    }

    // MARK: - Messages from the page

    fileprivate func received(_ message: WKScriptMessage, reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let kind = pageKind(message.frameInfo) else { return reply(nil, "Not allowed here") }
        guard let request = BridgeRequest.parse(message.body) else { return reply(nil, "Unknown message") }
        guard request.allowed.contains(kind) else { return reply(nil, "Not allowed here") }
        switch request {
        case .ready:
            plannerReady = true
            flush()
            smoke?.plannerReady()
            reply(true, nil)
        case .pong:
            smoke?.pong()
            reply(true, nil)
        case .appearance(let background):
            if let color = RGBA.parse(background), color.alpha > 0.5 { host?.pageBackgroundChanged(color) }
            reveal()
            reply(true, nil)
        case .haptic(let kind):
            host?.haptic(kind)
            reply(true, nil)
        case .share(let title, let text, let url):
            guard let host else { return reply(false, nil) }
            host.share(title: title, text: text, url: url) { done in reply(done, nil) }
        case .openExternal(let url):
            openExternally(url)
            reply(true, nil)
        case .speechAvailability(let lang, let onDevice):
            reply(speech.availability(lang: lang, onDevice: onDevice), nil)
        case .speechStart(let id, let lang, let interim, let onDevice):
            speech.start(id: id, lang: lang, interim: interim, onDevice: onDevice)
            reply(true, nil)
        case .speechStop(let id):
            speech.stop(id: id)
            reply(true, nil)
        case .speechAbort(let id):
            speech.abort(id: id)
            reply(true, nil)
        case .setServer(let address):
            choose(address, reply: reply)
        case .retry:
            if let server { loadPlanner(server) } else { showLocal(.setup) }
            reply(true, nil)
        case .log(let line):
            if AppEnvironment.isDebug || AppEnvironment.smokeTest { SmokeTest.say("LIS-PAGE \(line)") }
            reply(true, nil)
        }
    }

    /// The planner on the configured server, or the app's own page. Nothing else gets an answer.
    private func pageKind(_ frame: WKFrameInfo) -> PageKind? {
        let origin = frame.securityOrigin
        if origin.protocol == "file" {
            guard let url = frame.request.url, policy.isLocalPage(url) else { return nil }
            return .local
        }
        guard let server, let expected = server.originKey else { return nil }
        let port = origin.port != 0 ? origin.port : (origin.protocol == "https" ? 443 : origin.protocol == "http" ? 80 : 0)
        return "\(origin.protocol.lowercased())://\(origin.host.lowercased()):\(port)" == expected ? .planner : nil
    }

    /// The setup page's address: check it's a Life is short planner, then use it.
    private func choose(_ address: String, reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let url = ServerAddress.normalize(address) else {
            return reply(["ok": false, "message": "That doesn’t look like an address. Try something like life-is-short.vercel.app."] as [String: Any], nil)
        }
        Task { @MainActor [weak self] in
            let problem = await Self.problem(with: url)
            guard let self else { return }
            if let problem { return reply(["ok": false, "message": problem] as [String: Any], nil) }
            AppEnvironment.choose(server: url)
            self.server = url
            self.policy = NavigationPolicy(server: url, localPages: Self.pages)
            reply(["ok": true], nil)
            self.loadPlanner(url)
        }
    }

    /// Nil when the address serves Life is short's install manifest; otherwise what's wrong, in words.
    nonisolated private static func problem(with server: URL) async -> String? {
        let name = ServerAddress.display(server)
        var request = URLRequest(url: server.appendingPathComponent("manifest.webmanifest"))
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            guard (response as? HTTPURLResponse)?.statusCode == 200, (manifest?["name"] as? String) == "Life is short" else {
                return "\(name) answered, but it isn’t a Life is short planner."
            }
            return nil
        } catch {
            return "Couldn’t reach \(name). \(error.localizedDescription)"
        }
    }

    private static func describe(_ error: NSError) -> String {
        guard error.domain == NSURLErrorDomain else { return error.localizedDescription }
        switch error.code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed:
            return "You’re offline. It tries again by itself when you’re back online."
        case NSURLErrorTimedOut:
            return "The server took too long to answer."
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
            return "Couldn’t find the server. Check the address, or try a different one."
        case NSURLErrorCannotConnectToHost:
            return "The server isn’t answering."
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateNotYetValid, NSURLErrorServerCertificateHasUnknownRoot:
            return "The server’s security certificate isn’t valid."
        default:
            return error.localizedDescription
        }
    }

    private func loadFailed(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        // Our own cancel (a link that left the window) shows up as WebKit's "frame load interrupted" (102).
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        guard local == nil else { return }
        smoke?.failed("load: \(e.domain) \(e.code) \(e.localizedDescription)")
        showLocal(.offline(Self.describe(e)))
    }
}

// MARK: - Navigation

extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        // No target frame: a link that wants a new window. Decide here and keep it out of the new-window delegate.
        guard let frame = navigationAction.targetFrame else {
            decisionHandler(.cancel)
            follow(policy.decide(navigationAction.request.url, mainFrame: true), request: navigationAction.request)
            return
        }
        let decision = policy.decide(navigationAction.request.url, mainFrame: frame.isMainFrame)
        if decision == .allow { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        follow(decision, request: navigationAction.request)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        // The planner itself missing or failing (a wrong address, a broken deploy): say so rather than show a blank page.
        if navigationResponse.isForMainFrame, local == nil, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            decisionHandler(.cancel)
            smoke?.failed("HTTP \(http.statusCode)")
            showLocal(.offline("The server answered with error \(http.statusCode)."))
            return
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        plannerReady = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        reveal()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The system reclaimed the page's process (memory pressure, a long time in the background). Bring it back.
        reload()
    }
}

// MARK: - Windows, dialogs, permissions

extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        follow(policy.decide(navigationAction.request.url, mainFrame: true), request: navigationAction.request)
        return nil
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(frame.isMainFrame && pageKind(frame) == .planner && type == .microphone ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        #if os(iOS)
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, otherwise: completionHandler)
        #else
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        runSheet(alert) { _ in completionHandler() }
        #endif
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        #if os(iOS)
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
        #else
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        runSheet(alert) { completionHandler($0 == .alertFirstButtonReturn) }
        #endif
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        #if os(iOS)
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text) })
        present(alert) { completionHandler(nil) }
        #else
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        runSheet(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
        #endif
    }

    #if os(macOS)
    /// The file picker for Settings → Import from a file.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        guard let window = webView.window else {
            return completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    private func runSheet(_ alert: NSAlert, done: @escaping @MainActor (NSApplication.ModalResponse) -> Void) {
        guard let window = webView.window else { return done(alert.runModal()) }
        alert.beginSheetModal(for: window) { response in done(response) }
    }
    #else
    private func present(_ alert: UIAlertController, otherwise: @escaping @MainActor () -> Void) {
        guard let presenter = host?.presenter, presenter.presentedViewController == nil else { return otherwise() }
        presenter.present(alert, animated: true)
    }
    #endif
}

// MARK: - Bridge plumbing

/// Receives the page's messages for the controller without the web view keeping the controller alive.
@MainActor
private final class MessageRelay: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: WebController?

    init(_ controller: WebController) {
        self.controller = controller
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let controller else { return replyHandler(nil, "Gone") }
        controller.received(message, reply: replyHandler)
    }
}

#if os(macOS)
/// The planner's web view on the Mac, without the browser's items in its right-click menu.
final class PlannerWebView: WKWebView {
    private static let browserItems: Set<String> = [
        "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierDownloadLinkedFile",
        "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierDownloadImage",
        "WKMenuItemIdentifierOpenFrameInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow",
        "WKMenuItemIdentifierDownloadMedia", "WKMenuItemIdentifierReload",
        "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
    ]

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        for item in menu.items where Self.browserItems.contains(item.identifier?.rawValue ?? "") {
            menu.removeItem(item)
        }
        super.willOpenMenu(menu, with: event)
    }
}
#endif
