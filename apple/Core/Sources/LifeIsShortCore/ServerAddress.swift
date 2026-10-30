import Foundation

/// Where the planner lives: the origin of a Life is short deployment, from whatever was typed or configured.
public enum ServerAddress {
    /// "life-is-short.vercel.app", "https://example.com/app/" and "localhost:3000" become origins
    /// (`https://life-is-short.vercel.app`, `https://example.com`, `http://localhost:3000`). Nil when it can't be one.
    /// Plain http stays only for this machine and the local network; anywhere else it becomes https.
    public static func normalize(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(where: { $0.isWhitespace }) else { return nil }
        if !text.contains("://") {
            let authority = text.split(separator: "/", maxSplits: 1).first.map(String.init) ?? text
            let pieces = authority.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            guard pieces.count == 1 || pieces[1].allSatisfy(\.isASCII) && Int(pieces[1]) != nil else { return nil }
            text = (isLocal(host: pieces[0]) ? "http://" : "https://") + text
        }
        guard let parts = URLComponents(string: text),
              var scheme = parts.scheme?.lowercased(), scheme == "https" || scheme == "http",
              parts.user == nil, parts.password == nil,
              let host = parts.host?.lowercased(), isValidHost(host) else { return nil }
        if scheme == "http" && !isLocal(host: host) { scheme = "https" }
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        if let port = parts.port, port != (scheme == "https" ? 443 : 80) {
            guard (1...65535).contains(port) else { return nil }
            origin.port = port
        }
        return origin.url
    }

    /// This machine or the local network: localhost, .local names, unqualified names and private IPv4 addresses.
    public static func isLocal(host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h.hasSuffix(".localhost") || h.hasSuffix(".local") { return true }
        if !h.contains(".") { return !h.isEmpty }
        let labels = h.split(separator: ".", omittingEmptySubsequences: false)
        let octets = labels.compactMap { Int($0) }
        guard labels.count == 4, octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        switch (octets[0], octets[1]) {
        case (127, _), (10, _), (192, 168), (169, 254), (172, 16...31): return true
        default: return false
        }
    }

    /// The address as people write it: the host, and the port when it isn't the usual one.
    public static func display(_ url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    private static let hostCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-.")

    private static func isValidHost(_ host: String) -> Bool {
        !host.isEmpty && host.count <= 253
            && host.unicodeScalars.allSatisfy { hostCharacters.contains($0) }
            && !host.hasPrefix(".") && !host.hasSuffix(".") && !host.hasPrefix("-") && !host.contains("..")
    }
}

extension URL {
    /// scheme://host:port with the default port filled in, for telling whether two addresses are the same site.
    public var originKey: String? {
        guard let scheme = scheme?.lowercased(), let host = host?.lowercased(), !host.isEmpty else { return nil }
        let port = self.port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : 0)
        return "\(scheme)://\(host):\(port)"
    }

    /// The same scheme, host and port.
    public func isSameOrigin(as other: URL) -> Bool {
        guard let a = originKey, let b = other.originKey else { return false }
        return a == b
    }
}
