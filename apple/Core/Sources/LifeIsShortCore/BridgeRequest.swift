import Foundation

/// The pages that may talk to the app.
public enum PageKind: Equatable {
    /// The planner, on the configured server.
    case planner
    /// The app's own bundled setup and offline page.
    case local
}

/// A tap of feedback the planner can ask for.
public enum Haptic: String, CaseIterable {
    case success, warning, error, light, medium, selection
}

/// A message from the page (Bridge.js posts them through window.webkit.messageHandlers.lis), checked and typed.
/// Anything malformed, oversized or unknown is nil, and the app answers it with an error.
public enum BridgeRequest: Equatable {
    /// The planner is showing: commands waiting for it can be delivered.
    case ready
    /// The answer to a `ping` command.
    case pong
    /// The page's background colour, as its computed style gives it.
    case appearance(background: String)
    case haptic(Haptic)
    case share(title: String?, text: String?, url: URL?)
    case openExternal(URL)
    case speechAvailability(lang: String?, onDevice: Bool)
    case speechStart(id: String, lang: String?, interim: Bool, onDevice: Bool)
    case speechStop(id: String)
    case speechAbort(id: String)
    /// From the setup page: use this server.
    case setServer(address: String)
    /// From the offline page: try the planner again.
    case retry
    /// A console error from the page. Printed only in the CI smoke test and debug builds.
    case log(String)

    /// Who may send it. The planner can't change the server, and the bundled pages can't reach speech or sharing.
    public var allowed: Set<PageKind> {
        switch self {
        case .appearance, .log: return [.planner, .local]
        case .setServer, .retry: return [.local]
        default: return [.planner]
        }
    }

    public static func parse(_ body: Any) -> BridgeRequest? {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return nil }
        let fields = Fields(message: message)
        switch type {
        case "ready":
            return .ready
        case "pong":
            return .pong
        case "appearance":
            guard let background = fields.text("background", max: 128) else { return nil }
            return .appearance(background: background)
        case "haptic":
            guard let kind = fields.text("kind", max: 16), let haptic = Haptic(rawValue: kind) else { return nil }
            return .haptic(haptic)
        case "share":
            let link = fields.url("url").flatMap { isShareable($0) ? $0 : nil }
            let words = fields.text("text", max: 4000)
            guard link != nil || words != nil else { return nil }
            return .share(title: fields.text("title", max: 500), text: words, url: link)
        case "external.open":
            guard let link = fields.url("url"), isExternal(link) else { return nil }
            return .openExternal(link)
        case "speech.available":
            return .speechAvailability(lang: fields.text("lang", max: 35), onDevice: fields.flag("onDevice"))
        case "speech.start":
            guard let id = fields.id() else { return nil }
            return .speechStart(id: id, lang: fields.text("lang", max: 35), interim: fields.flag("interim"), onDevice: fields.flag("onDevice"))
        case "speech.stop":
            guard let id = fields.id() else { return nil }
            return .speechStop(id: id)
        case "speech.abort":
            guard let id = fields.id() else { return nil }
            return .speechAbort(id: id)
        case "server.set":
            guard let address = fields.text("address", max: 512) else { return nil }
            return .setServer(address: address)
        case "page.retry":
            return .retry
        case "log":
            guard let line = message["message"] as? String else { return nil }
            return .log(String(line.prefix(2000)))
        default:
            return nil
        }
    }

    /// Links the page may send to the browser or another app.
    static func isExternal(_ url: URL) -> Bool {
        ["http", "https", "mailto", "tel", "sms"].contains(url.scheme?.lowercased() ?? "")
    }

    static func isShareable(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    }

    /// Typed, size-limited reads from a message.
    private struct Fields {
        let message: [String: Any]

        func text(_ key: String, max: Int = 2048) -> String? {
            guard let value = message[key] as? String, value.count <= max else { return nil }
            return value
        }

        func flag(_ key: String) -> Bool {
            (message[key] as? Bool) ?? false
        }

        func url(_ key: String) -> URL? {
            text(key, max: 4096).flatMap { URL(string: $0) }
        }

        func id() -> String? {
            guard let value = text("id", max: 64), !value.isEmpty else { return nil }
            return value
        }
    }
}
