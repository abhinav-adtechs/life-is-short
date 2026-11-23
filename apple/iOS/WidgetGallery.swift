import LifeIsShortCore
import SwiftUI
import UIKit
import WidgetKit

/// Pictures of every widget, drawn by the app for CI's smoke test (Shared/SmokeTest.swift; apple/scripts/smoke.sh keeps
/// them with the run): the window at each time of day, the three themes, the empty, plain and lock screen ones, and the
/// Lock Screen's Now (the Live Activity) in each of its states, on the Lock Screen and in the Dynamic Island. The
/// views are the widget's own (Widgets/Design); the pictures and type come from the widget extension inside the app.
@MainActor
enum WidgetGallery {
    /// Friday 20 November 2026, the showcase's day.
    private static let day: Date = {
        Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 20, hour: 9)) ?? Date()
    }()

    /// The widget extension inside the app, with the pictures and type.
    static var extensionBundle: Bundle? {
        guard let plugins = Bundle.main.builtInPlugInsURL,
              let appex = (try? FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil))?
                .first(where: { $0.pathExtension == "appex" }) else { return nil }
        return Bundle(url: appex)
    }

    /// Draws the pictures into `directory`; the files it wrote.
    static func render(into directory: URL) -> [URL] {
        guard let bundle = extensionBundle else {
            SmokeTest.say("LIS-SMOKE widget-shot-failed the widget extension isn’t in the app")
            return []
        }
        WidgetFonts.register(from: bundle)
        let sheets: [(String, AnyView)] = [
            ("widgets-window", AnyView(windowSheet(bundle))),
            ("widgets-theme", AnyView(themeSheet(bundle))),
            ("widgets-states", AnyView(statesSheet(bundle))),
            ("widgets-lock", AnyView(lockSheet(bundle))),
            ("widgets-live", AnyView(liveLockSheet(bundle))),
            ("widgets-island", AnyView(liveIslandSheet(bundle))),
        ]
        var written: [URL] = []
        for (name, sheet) in sheets {
            let renderer = ImageRenderer(content: sheet.fixedSize())
            renderer.scale = 2
            guard let data = renderer.uiImage?.pngData() else {
                SmokeTest.say("LIS-SMOKE widget-shot-failed \(name)")
                continue
            }
            let file = directory.appendingPathComponent("\(name).png")
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try data.write(to: file)
                written.append(file)
            } catch {
                SmokeTest.say("LIS-SMOKE widget-shot-failed \(name): \(error.localizedDescription)")
            }
        }
        return written
    }

    // MARK: - The sheets

    private static func moment(_ hour: Int, _ minute: Int = 0, look: WidgetSnapshot.Look = .standard, planned: Bool = true) -> WidgetMoment {
        WidgetSamples.moment(hour, minute, on: day, look: look, planned: planned)
    }

    private static func model(_ m: WidgetMoment, _ style: WidgetStyle, _ bundle: Bundle, scene: WidgetScene? = nil, plain: Bool = false) -> NowModel {
        NowModel(moment: m, style: style, live: false, bundle: bundle, scene: scene, plain: plain)
    }

    /// The window at each time of day: on a slot, between slots, and the large one.
    private static func windowSheet(_ b: Bundle) -> some View {
        Sheet(title: "The window") {
            ForEach(WidgetScene.allCases, id: \.self) { scene in
                Row(title: scene.rawValue) {
                    Cell(model(moment(10, 50), .window, b, scene: scene), .systemSmall, caption: "on a slot")
                    Cell(model(moment(11, 40), .window, b, scene: scene), .systemSmall, caption: "between slots")
                    Cell(model(moment(10, 50), .window, b, scene: scene), .systemMedium, caption: "on a slot")
                    Cell(model(moment(11, 40), .window, b, scene: scene), .systemMedium, caption: "between slots")
                    Cell(model(moment(10, 50), .window, b, scene: scene), .systemLarge, caption: "planned", dark: scene == .night)
                }
            }
        }
    }

    /// The planner's three themes, by day and by night.
    private static func themeSheet(_ b: Bundle) -> some View {
        let day = WidgetSnapshot.Look(light: .day, dark: .night, accentLight: "#D98A1C", accentDark: "#F2A541")
        let looks: [(String, WidgetSnapshot.Look, Bool)] = [("Tide", .standard, false), ("Day train", day, false), ("Night train", .standard, true)]
        return Sheet(title: "Your theme") {
            ForEach(looks, id: \.0) { name, look, dark in
                Row(title: name) {
                    Cell(model(moment(10, 50, look: look), .theme, b), .systemSmall, caption: "on a slot", dark: dark)
                    Cell(model(moment(11, 40, look: look), .theme, b), .systemSmall, caption: "between slots", dark: dark)
                    Cell(model(moment(10, 50, look: look), .theme, b), .systemMedium, caption: "on a slot", dark: dark)
                    Cell(model(moment(12, 10, look: look, planned: false), .theme, b), .systemLarge, caption: "not planned", dark: dark)
                }
            }
        }
    }

    /// Nothing to do, nothing from the app yet, a stale day, and the tinted Home Screen.
    private static func statesSheet(_ b: Bundle) -> some View {
        let empty = WidgetSnapshot(at: day, day: WidgetTimeline.dayString(day), items: [], today: .init(done: 3, total: 3), outcomes: nil)
        let clear = WidgetTimeline.moment(at: day.addingTimeInterval(3 * 3600), snapshot: empty)
        let none = WidgetTimeline.moment(at: day.addingTimeInterval(3 * 3600), snapshot: nil)
        let old = WidgetTimeline.moment(at: day.addingTimeInterval(52 * 3600), snapshot: WidgetSamples.snapshot(on: day))
        return Sheet(title: "States") {
            Row(title: "all clear") {
                Cell(model(clear, .window, b), .systemSmall, caption: "window")
                Cell(model(clear, .window, b), .systemMedium, caption: "window")
                Cell(model(clear, .window, b, scene: .amber), .systemLarge, caption: "window, evening")
                Cell(model(clear, .theme, b), .systemSmall, caption: "theme")
            }
            Row(title: "before the app has said anything") {
                Cell(model(none, .window, b), .systemSmall, caption: "window")
                Cell(model(none, .window, b), .systemMedium, caption: "window")
                Cell(model(none, .window, b), .systemLarge, caption: "window")
                Cell(model(none, .theme, b), .systemSmall, caption: "theme", dark: true)
            }
            Row(title: "the evening, the app not open for two days, tinted") {
                Cell(model(moment(18), .window, b), .systemMedium, caption: "rest of the day")
                Cell(model(old, .window, b), .systemSmall, caption: "stale")
                Cell(model(moment(10, 50), .theme, b, plain: true), .systemSmall, caption: "tinted", tinted: true)
                Cell(model(moment(10, 50), .theme, b, plain: true), .systemMedium, caption: "tinted", tinted: true)
            }
        }
    }

    /// The Lock Screen's Now on the sample day, in each of its states (docs/apple.md → Live Activity).
    private static func liveStates(_ style: LiveNowStyle, _ b: Bundle) -> [(String, NowActivityModel)] {
        let calendar = Calendar.current
        let snapshot = WidgetSamples.snapshot(on: day, calendar: calendar)
        func at(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        }
        func state(_ date: Date, hidden: Bool = false, _ s: WidgetSnapshot? = nil) -> LiveNowState? {
            LiveNow.state(at: date, snapshot: s ?? snapshot, style: style, hidden: hidden, calendar: calendar)
        }
        let empty = WidgetSnapshot(at: at(12), day: snapshot.day, items: [], today: .init(done: 7, total: 7), outcomes: nil)
        let all: [(String, LiveNowState?, Bool, Date?)] = [
            ("a · on a slot", state(at(10, 48)), false, nil),
            ("b · free until the next slot", state(at(12, 40)), false, nil),
            ("c · in a meeting", state(at(16, 41)), false, nil),
            ("d · the rest of the day", state(at(19, 30)), false, nil),
            ("e · all clear", state(at(13), empty), false, nil),
            ("f · out of date: past its turn, not refreshed", state(at(10, 48)), true, at(11, 42)),
            ("g · the day’s end", state(at(20)).map { LiveNow.over(state: $0, at: at(21, 5), calendar: calendar) }, false, nil),
            ("h · task names hidden", state(at(10, 48), hidden: true), false, nil),
        ]
        return all.compactMap { name, state, stale, date in
            state.map { (name, NowActivityModel(state: $0, isStale: stale, live: false, bundle: b, date: date)) }
        }
    }

    private static func liveLockSheet(_ b: Bundle) -> some View {
        let window = liveStates(.window, b), theme = liveStates(.theme, b)
        return Sheet(title: "Now on the Lock Screen (Live Activity)") {
            ForEach(0..<min(window.count, theme.count), id: \.self) { i in
                Row(title: window[i].0) {
                    LiveCell(model: window[i].1, caption: "the window")
                    LiveCell(model: theme[i].1, caption: "your theme, Tide")
                    LiveCell(model: theme[i].1, caption: "your theme, Night train", dark: true)
                }
            }
        }
    }

    private static func liveIslandSheet(_ b: Bundle) -> some View {
        let window = liveStates(.window, b), theme = liveStates(.theme, b)
        return Sheet(title: "Now in the Dynamic Island") {
            ForEach(0..<min(window.count, theme.count), id: \.self) { i in
                Row(title: theme[i].0) {
                    IslandCell(model: theme[i].1, kind: .compact, caption: "compact")
                    IslandCell(model: theme[i].1, kind: .minimal, caption: "minimal")
                    IslandCell(model: window[i].1, kind: .expanded, caption: "expanded, the window")
                    IslandCell(model: theme[i].1, kind: .expanded, caption: "expanded, your theme")
                }
            }
        }
    }

    private static func lockSheet(_ b: Bundle) -> some View {
        Sheet(title: "Lock screen") {
            ForEach([(10, 50), (11, 40), (22, 0)], id: \.0) { hour, minute in
                Row(title: String(format: "%02d:%02d", hour, minute)) {
                    Cell(model(moment(hour, minute), .theme, b), .accessoryRectangular, caption: "rectangular", dark: true)
                    Cell(model(moment(hour, minute), .theme, b), .accessoryCircular, caption: "circular", dark: true)
                    Cell(model(moment(hour, minute), .theme, b), .accessoryInline, caption: "inline", dark: true)
                }
            }
        }
    }
}

// MARK: - Laying them out

private struct Sheet<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            Text(title).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
            content
        }
        .padding(28)
        .background(Color(red: 0.16, green: 0.18, blue: 0.21))
    }
}

private struct Row<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
            HStack(alignment: .top, spacing: 20) { content }
        }
    }
}

/// The Lock Screen's Now as the Lock Screen draws it.
private struct LiveCell: View {
    let model: NowActivityModel
    var caption: String
    var dark = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(caption).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            NowActivityLockView(model: model)
                .frame(width: 371)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .environment(\.colorScheme, dark ? .dark : .light)
        }
    }
}

/// The Lock Screen's Now in the Dynamic Island, drawn on its black.
private struct IslandCell: View {
    enum Kind { case compact, minimal, expanded }

    let model: NowActivityModel
    let kind: Kind
    var caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(caption).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            island.environment(\.colorScheme, .dark)
        }
    }

    @ViewBuilder private var island: some View {
        switch kind {
        case .compact:
            HStack(spacing: 0) {
                IslandGlyph(m: model, size: 22).padding(.leading, 8)
                Spacer(minLength: 0)
                IslandTrailing(m: model).frame(maxWidth: 52, alignment: .trailing).padding(.trailing, 10)
            }
            .frame(width: 231, height: 37)
            .background(Capsule().fill(.black))
        case .minimal:
            IslandGlyph(m: model, size: 24).frame(width: 37, height: 37).background(Circle().fill(.black))
        case .expanded:
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    IslandExpandedLeading(m: model)
                    Spacer(minLength: 8)
                    IslandExpandedTrailing(m: model)
                }
                IslandExpandedBottom(m: model)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(width: 371)
            .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))
        }
    }
}

private struct Cell: View {
    let model: NowModel
    let family: WidgetFamily
    var caption: String
    var dark = false
    var tinted = false

    init(_ model: NowModel, _ family: WidgetFamily, caption: String, dark: Bool = false, tinted: Bool = false) {
        self.model = model
        self.family = family
        self.caption = caption
        self.dark = dark
        self.tinted = tinted
    }

    private var size: CGSize {
        switch family {
        case .systemSmall: return CGSize(width: 170, height: 170)
        case .systemMedium: return CGSize(width: 364, height: 170)
        case .accessoryRectangular: return CGSize(width: 172, height: 76)
        case .accessoryCircular: return CGSize(width: 76, height: 76)
        case .accessoryInline: return CGSize(width: 240, height: 22)
        default: return CGSize(width: 364, height: 382)
        }
    }

    private var accessory: Bool { [.accessoryRectangular, .accessoryCircular, .accessoryInline].contains(family) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(caption).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
            NowWidgetView(model: model, family: family, drawsBackground: true)
                .frame(width: size.width, height: size.height)
                .background(tinted ? Color(red: 0.12, green: 0.2, blue: 0.3) : accessory ? Color.black.opacity(0.35) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: accessory ? 12 : 22, style: .continuous))
                .foregroundStyle(accessory ? Color.white : Color.primary)
                .environment(\.colorScheme, dark || accessory ? .dark : .light)
        }
    }
}
