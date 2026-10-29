import Foundation

/// A panel in the planner that the app can open: the same ones the planner's URL hash opens.
public enum Sheet: String, CaseIterable {
    case settings, analytics, review, share
}

/// What the app asks the planner to do, from Siri, a Home Screen quick action, a lifeisshort:// link or the Mac's menu
/// bar. The planner handles them in components/Planner.tsx, through lib/native.ts.
public enum NativeCommand: Equatable {
    /// Open the chat bar. With text, it's sent as a dump, so the plan is waiting for review.
    case dump(text: String?)
    /// Open the chat bar and start listening.
    case listen
    case open(Sheet)
    /// The answer from Google's sign-in sheet: the app loads it into the planner's callback page.
    case googleCallback(query: String)
    /// Asks the planner to answer `pong`, to show the round trip works (the CI smoke test).
    case ping

    /// The command as the page receives it; nil for the ones the app handles itself.
    public var payload: [String: String]? {
        switch self {
        case .dump(let text): return text.map { ["name": "dump", "text": $0] } ?? ["name": "dump"]
        case .listen: return ["name": "listen"]
        case .open(let sheet): return ["name": "open", "sheet": sheet.rawValue]
        case .ping: return ["name": "ping"]
        case .googleCallback: return nil
        }
    }
}

/// The app's own links: lifeisshort://dump?text=…, lifeisshort://listen, lifeisshort://settings (analytics, review,
/// share), and lifeisshort://google/callback?…, where Google's sign-in sheet hands its answer back.
public enum DeepLink {
    public static let scheme = "lifeisshort"
    /// The longest dump a link or Siri can hand over.
    public static let maxText = 4000

    public static func command(from url: URL) -> NativeCommand? {
        guard url.scheme?.lowercased() == scheme else { return nil }
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        switch (url.host ?? "").lowercased() {
        case "dump", "add":
            return .dump(text: cleanText(parts?.queryItems?.first(where: { $0.name == "text" })?.value))
        case "listen", "speak":
            return .listen
        case "google":
            guard url.path == "/callback" else { return nil }
            return .googleCallback(query: parts?.percentEncodedQuery ?? "")
        case let action:
            return Sheet(rawValue: action).map(NativeCommand.open)
        }
    }

    /// Home Screen quick actions (UIApplicationShortcutItems in the iOS Info.plist).
    public static func command(forShortcut type: String) -> NativeCommand? {
        switch type {
        case "dump": return .dump(text: nil)
        case "listen": return .listen
        default: return nil
        }
    }

    /// Text from Siri, Shortcuts or a link, trimmed and capped. Nil when there's nothing in it.
    public static func cleanText(_ text: String?) -> String? {
        guard let t = text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return String(t.prefix(maxText))
    }

    /// The planner's Google callback page for a sign-in answer: the same query, on the server.
    public static func googleCallbackURL(server: URL, query: String) -> URL? {
        guard server.originKey != nil, !query.contains(where: { $0.isWhitespace || $0 == "#" }) else { return nil }
        var base = server.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + "/google/callback" + (query.isEmpty ? "" : "?" + query))
    }
}
