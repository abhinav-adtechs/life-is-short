import CoreText
import LifeIsShortCore
import SwiftUI

// How the widgets look: the planner's type (Geist), its three themes (app/globals.css), and the home page's window and
// ticket (app/home.css). Shared by the widget extension and the app, which draws them for CI (iOS/WidgetGallery.swift).

/// What a home screen widget looks like, chosen in its Edit Widget menu (Extension/NowWidget.swift).
enum WidgetStyle: String, CaseIterable, Sendable {
    /// The view out of the train window for the time of day, with the task on a ticket.
    case window
    /// The planner's own theme: Tide, Day train or Night train.
    case theme
}

/// The widget sizes the window's pictures are framed for (apple/scripts/scenes.mjs), and the Lock Screen's Now (the
/// Live Activity), which iOS won't let a picture be taller than.
enum SceneSize: String {
    case small, medium, large, activity
}

extension WidgetScene {
    func image(_ size: SceneSize, bundle: Bundle) -> Image {
        Image("window-\(rawValue)-\(size.rawValue)", bundle: bundle)
    }

    /// A wash over the view where the words go, so white type reads on any sky (app/home.css → .shade).
    var shade: [Color] {
        switch self {
        case .meadow, .balloon: return [Color(red: 8 / 255, green: 30 / 255, blue: 80 / 255).opacity(0.42), Color(red: 8 / 255, green: 30 / 255, blue: 80 / 255).opacity(0)]
        case .amber: return [Color(red: 40 / 255, green: 12 / 255, blue: 60 / 255).opacity(0.42), Color(red: 40 / 255, green: 12 / 255, blue: 60 / 255).opacity(0)]
        case .night: return [Color(red: 4 / 255, green: 6 / 255, blue: 20 / 255).opacity(0.32), Color(red: 4 / 255, green: 6 / 255, blue: 20 / 255).opacity(0)]
        }
    }
}

// MARK: - Type

enum WidgetFonts {
    static let files = ["Geist-Regular", "Geist-Medium", "Geist-SemiBold", "GeistMono-Medium", "GeistMono-SemiBold"]
    private static var done = Set<String>()

    /// Geist for this process, from the bundle that carries it: the widget extension's own, or in the app, the
    /// extension inside it. Once per bundle; a font that's already there is fine.
    static func register(from bundle: Bundle) {
        guard !done.contains(bundle.bundlePath) else { return }
        done.insert(bundle.bundlePath)
        for name in files {
            guard let url = bundle.url(forResource: name, withExtension: "ttf") else { continue }
            _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

extension Font {
    /// Geist at a fixed size: a widget's space is fixed, so its type is too.
    static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium: name = "Geist-Medium"
        case .semibold, .bold, .heavy, .black: name = "Geist-SemiBold"
        default: name = "Geist-Regular"
        }
        return .custom(name, fixedSize: size)
    }

    /// Geist Mono, for times and the ticket's printed labels.
    static func geistMono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .custom(weight == .semibold || weight == .bold ? "GeistMono-SemiBold" : "GeistMono-Medium", fixedSize: size)
    }
}

/// The ticket's printed labels: small caps-height mono, spaced out (app/home.css → .ticket .label).
struct Printed: ViewModifier {
    var size: CGFloat = 10

    func body(content: Content) -> some View {
        content.font(.geistMono(size)).tracking(size * 0.1).textCase(.uppercase)
    }
}

extension View {
    func printed(_ size: CGFloat = 10) -> some View { modifier(Printed(size: size)) }
}

// MARK: - Colour

extension Color {
    /// #RRGGBB, as the planner sends it; nil for anything else.
    init?(hex: String?) {
        guard let hex, hex.count == 7, hex.first == "#", let n = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
    }

    init(rgb n: UInt32, opacity: Double = 1) {
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255, opacity: opacity)
    }
}

/// One theme's colours, as app/globals.css sets them, and the light it carries (a lamp, the sun on paper, still water).
struct WidgetPalette {
    var top: Color
    var bottom: Color
    var ink: Color
    var muted: Color
    var faint: Color
    var hair: Color
    var accent: Color
    var track: Color
    /// The theme's light, from a corner.
    var glow: Color
    var dark: Bool

    static func of(_ theme: WidgetSnapshot.Theme, accent hex: String?) -> WidgetPalette {
        switch theme {
        case .tide:
            let accent = Color(hex: hex) ?? Color(rgb: 0x0A7DB2)
            return .init(top: Color(rgb: 0xFFFFFF), bottom: Color(rgb: 0xEDF3F6), ink: Color(rgb: 0x12202A), muted: Color(rgb: 0x4F5E69),
                         faint: Color(rgb: 0x84919A), hair: Color(rgb: 0x12202A, opacity: 0.09), accent: accent,
                         track: accent.opacity(0.16), glow: accent.opacity(0.10), dark: false)
        case .day:
            let accent = Color(hex: hex) ?? Color(rgb: 0xD98A1C)
            return .init(top: Color(rgb: 0xFFFDF8), bottom: Color(rgb: 0xF4EEE2), ink: Color(rgb: 0x1B2230), muted: Color(rgb: 0x545C69),
                         faint: Color(rgb: 0x8A8F98), hair: Color(rgb: 0x1B2230, opacity: 0.09), accent: accent,
                         track: accent.opacity(0.18), glow: Color(rgb: 0xFFC86E, opacity: 0.30), dark: false)
        case .night:
            let accent = Color(hex: hex) ?? Color(rgb: 0xF2A541)
            return .init(top: Color(rgb: 0x18202B), bottom: Color(rgb: 0x0E131A), ink: Color(rgb: 0xECEAE5), muted: Color(rgb: 0x9DA4AE),
                         faint: Color(rgb: 0x6E7580), hair: Color(rgb: 0xFFFFFF, opacity: 0.07), accent: accent,
                         track: accent.opacity(0.18), glow: accent.opacity(0.22), dark: true)
        }
    }

    /// No background of its own: StandBy, and the tinted and clear Home Screens, colour it themselves.
    static let plain = WidgetPalette(top: .clear, bottom: .clear, ink: .white, muted: .white.opacity(0.72), faint: .white.opacity(0.5),
                                     hair: .white.opacity(0.18), accent: .white, track: .white.opacity(0.22), glow: .clear, dark: true)
}

/// The ticket's paper and ink: printed paper whatever the mode (app/home.css → .ticket).
enum Paper {
    static let paper = Color(rgb: 0xFBF6EA)
    static let ink = Color(rgb: 0x14382F)
    static let muted = Color(rgb: 0x476F5A)
    static let line = Color(rgb: 0x14382F, opacity: 0.22)
    static let track = Color(rgb: 0x14382F, opacity: 0.13)
    /// The ticket's stamp red, for what's urgent: a shade deeper than the home page's, so small type reads on paper.
    static let red = Color(rgb: 0xB83A27)
}

// MARK: - The ticket

/// A ticket: rounded paper with a half-circle bitten out of each side at the tear line (app/home.css → .ticket's mask).
struct TicketShape: Shape {
    /// The tear line, down from the top.
    var notch: CGFloat
    var radius: CGFloat = 6
    var corner: CGFloat = 12

    func path(in rect: CGRect) -> Path {
        let c = min(corner, rect.width / 2, rect.height / 2)
        let r = radius
        let y = min(max(rect.minY + notch, rect.minY + c + r), rect.maxY - c - r)
        // How far a cubic's handles sit to bend a quarter circle.
        let k = r * 0.5523
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + c, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - c, y: rect.minY))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + c), radius: c)
        // Down the right side, around the bite.
        p.addLine(to: CGPoint(x: rect.maxX, y: y - r))
        p.addCurve(to: CGPoint(x: rect.maxX - r, y: y), control1: CGPoint(x: rect.maxX - k, y: y - r), control2: CGPoint(x: rect.maxX - r, y: y - k))
        p.addCurve(to: CGPoint(x: rect.maxX, y: y + r), control1: CGPoint(x: rect.maxX - r, y: y + k), control2: CGPoint(x: rect.maxX - k, y: y + r))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - c))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - c, y: rect.maxY), radius: c)
        p.addLine(to: CGPoint(x: rect.minX + c, y: rect.maxY))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - c), radius: c)
        // Up the left side, around its bite.
        p.addLine(to: CGPoint(x: rect.minX, y: y + r))
        p.addCurve(to: CGPoint(x: rect.minX + r, y: y), control1: CGPoint(x: rect.minX + k, y: y + r), control2: CGPoint(x: rect.minX + r, y: y + k))
        p.addCurve(to: CGPoint(x: rect.minX, y: y - r), control1: CGPoint(x: rect.minX + r, y: y - k), control2: CGPoint(x: rect.minX + k, y: y - r))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + c))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + c, y: rect.minY), radius: c)
        p.closeSubpath()
        return p
    }
}

/// The ticket's tear line: a dashed rule across it.
struct Perforation: View {
    var body: some View {
        Line().stroke(Paper.line, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
            .frame(height: 1.5)
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: rect.minX, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            return p
        }
    }
}

// MARK: - Small parts

/// The now dot: a lamp in the window, the accent in a theme (components/Next.tsx → .nowdot).
struct Lamp: View {
    var color: Color = Color(rgb: 0xFFE7A8)
    var glow = true

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7)
            .background(Circle().fill(color.opacity(0.24)).frame(width: 13, height: 13))
            .shadow(color: glow ? color.opacity(0.7) : .clear, radius: 5)
    }
}

/// A goal's colour, as a dot; a ring for off-goal work.
struct GoalDot: View {
    var color: Color?
    var ring: Color
    var size: CGFloat = 7

    var body: some View {
        if let color {
            Circle().fill(color).frame(width: size, height: size)
        } else {
            Circle().strokeBorder(ring, lineWidth: 1.2).frame(width: size, height: size)
        }
    }
}

/// How much of Now's slot is left, draining as it goes. In a widget the system runs it by itself; in a still
/// picture (the app's gallery) it's drawn where it stands.
struct SlotBar: View {
    var slot: ClosedRange<Date>
    var remaining: Double
    var fill: Color
    var track: Color
    var height: CGFloat = 3
    var live: Bool

    var body: some View {
        if live {
            ProgressView(timerInterval: slot, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                .progressViewStyle(.linear)
                .tint(fill)
                .labelsHidden()
        } else {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(track)
                    Capsule().fill(fill).frame(width: max(height, g.size.width * remaining))
                }
            }
            .frame(height: height)
        }
    }
}

/// Today's steps for an outcome, as short bars (components/Today.tsx → .tb-seg).
struct Steps: View {
    var done: Int
    var total: Int
    var on: Color
    var off: Color

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<min(total, 6), id: \.self) { i in
                Capsule().fill(i < done ? on : off).frame(width: 9, height: 4)
            }
        }
    }
}
