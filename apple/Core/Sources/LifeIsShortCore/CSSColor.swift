import Foundation

/// A colour from the page's computed style. The app paints its status bar, title bar and window with it, and picks
/// light or dark status bar text from it.
public struct RGBA: Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// WCAG relative luminance, 0 (black) to 1 (white).
    public var luminance: Double {
        func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// White text contrasts better with it than black text does.
    public var isDark: Bool { luminance < 0.179 }

    /// "rgb(237, 242, 244)", "rgba(0, 0, 0, 0.5)", "rgb(13 17 23 / 80%)", "#0d1117", "#fff", "color(srgb 0.1 0.2 0.3)"
    /// and "transparent". Nil for anything else.
    public static func parse(_ css: String) -> RGBA? {
        let s = css.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s == "transparent" { return RGBA(red: 0, green: 0, blue: 0, alpha: 0) }
        if s.hasPrefix("#") { return hex(String(s.dropFirst())) }
        guard let open = s.firstIndex(of: "("), s.hasSuffix(")") else { return nil }
        let name = s[..<open].trimmingCharacters(in: .whitespaces)
        let inside = s[s.index(after: open)..<s.index(before: s.endIndex)]
        var tokens = inside.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).map(String.init)
        switch name {
        case "rgb", "rgba":
            guard tokens.count == 3 || tokens.count == 4,
                  let r = channel(tokens[0], scale: 255), let g = channel(tokens[1], scale: 255), let b = channel(tokens[2], scale: 255) else { return nil }
            let a = tokens.count == 4 ? channel(tokens[3], scale: 1) : 1
            return a.map { RGBA(red: r, green: g, blue: b, alpha: $0) }
        case "color":
            guard tokens.first == "srgb" else { return nil }
            tokens.removeFirst()
            guard tokens.count == 3 || tokens.count == 4,
                  let r = channel(tokens[0], scale: 1), let g = channel(tokens[1], scale: 1), let b = channel(tokens[2], scale: 1) else { return nil }
            let a = tokens.count == 4 ? channel(tokens[3], scale: 1) : 1
            return a.map { RGBA(red: r, green: g, blue: b, alpha: $0) }
        default:
            return nil
        }
    }

    /// A number on 0...scale, or a percentage, as 0...1.
    private static func channel(_ token: String, scale: Double) -> Double? {
        let value: Double?
        if token.hasSuffix("%") { value = Double(String(token.dropLast())).map { $0 / 100 } } else { value = Double(token).map { $0 / scale } }
        guard let v = value, v.isFinite else { return nil }
        return min(max(v, 0), 1)
    }

    private static func hex(_ digits: String) -> RGBA? {
        guard [3, 4, 6, 8].contains(digits.count), digits.allSatisfy(\.isHexDigit) else { return nil }
        let full = digits.count <= 4 ? digits.map { "\($0)\($0)" }.joined() : digits
        var values: [Double] = []
        var i = full.startIndex
        while i < full.endIndex {
            let j = full.index(i, offsetBy: 2)
            guard let byte = UInt8(full[i..<j], radix: 16) else { return nil }
            values.append(Double(byte) / 255)
            i = j
        }
        return RGBA(red: values[0], green: values[1], blue: values[2], alpha: values.count == 4 ? values[3] : 1)
    }
}
