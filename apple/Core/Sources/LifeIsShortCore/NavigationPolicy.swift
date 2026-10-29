import Foundation

/// What the app does with something that wants to load in its window.
public enum NavigationDecision: Equatable {
    /// Load it in the window.
    case allow
    /// Hand it to the browser, or to whichever app owns the link (Mail, Phone, Maps).
    case openExternally(URL)
    /// Google's consent screen. Google refuses sign-in inside an app's web view, so it goes to the system's sign-in
    /// sheet, and the answer comes back through the app's own link.
    case signInWithGoogle(URL)
    /// One of the app's own links (lifeisshort://).
    case deepLink(URL)
    /// Nothing to load.
    case cancel
}

/// Keeps the window on the planner. Only the planner (/app) and Google's callback on the planner's own server load in
/// it, plus the app's bundled setup and offline page. Everything else goes to the browser or the sign-in sheet, so the
/// app never shows (or answers) anyone else's page.
public struct NavigationPolicy {
    public let server: URL?
    /// The folder of the app's bundled pages.
    public let localPages: URL?

    public init(server: URL?, localPages: URL?) {
        self.server = server
        self.localPages = localPages
    }

    public func decide(_ url: URL?, mainFrame: Bool) -> NavigationDecision {
        guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }
        switch scheme {
        case "about", "blob", "data":
            return .allow
        case DeepLink.scheme:
            return .deepLink(url)
        case "file":
            return isLocalPage(url) ? .allow : .cancel
        case "http", "https":
            if let server, url.isSameOrigin(as: server) {
                if Self.isPlannerPage(url) || !mainFrame { return .allow }
                // The home page, the privacy policy and the like: they're for the browser.
                return .openExternally(url)
            }
            if Self.isGoogleSignIn(url) { return mainFrame ? .signInWithGoogle(url) : .cancel }
            return mainFrame ? .openExternally(url) : .cancel
        default:
            return mainFrame ? .openExternally(url) : .cancel
        }
    }

    /// One of the app's own bundled pages.
    public func isLocalPage(_ url: URL) -> Bool {
        guard url.isFileURL, let localPages else { return false }
        let folder = localPages.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        return path == folder || path.hasPrefix(folder.hasSuffix("/") ? folder : folder + "/")
    }

    /// The planner and Google's way back into it.
    public static func isPlannerPage(_ url: URL) -> Bool {
        let path = url.path
        return path == "/app" || path.hasPrefix("/app/") || path == "/google/callback"
    }

    /// Google's OAuth consent screen (lib/server/google.ts builds it).
    public static func isGoogleSignIn(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == "accounts.google.com" && url.path.hasPrefix("/o/oauth2/")
    }
}
