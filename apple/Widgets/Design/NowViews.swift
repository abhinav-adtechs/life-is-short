import LifeIsShortCore
import SwiftUI
import WidgetKit

// The Now widget, every size: the one thing to do now, how long you have for it, and what comes after. In the window
// look the task is on a ticket over the view out of the train (app/home.css → the window and the ticket); in the theme
// look it's set in the planner's own colours (components/Next.tsx). The lock screen's are plain, as the system tints them.

/// What a widget draws, and how.
struct NowModel {
    var moment: WidgetMoment
    var style: WidgetStyle
    /// A running widget, whose bars the system runs by itself; false for a still picture (the app's gallery).
    var live: Bool
    /// Where the pictures and type are: the widget extension's bundle.
    var bundle: Bundle
    /// The view out of the window: the moment's own unless a gallery picks one.
    var scene: WidgetScene
    /// Drawn as the tinted and clear Home Screens and StandBy draw it, without a background of its own.
    var plain = false

    init(moment: WidgetMoment, style: WidgetStyle, live: Bool, bundle: Bundle, scene: WidgetScene? = nil, plain: Bool = false) {
        self.moment = moment
        self.style = style
        self.live = live
        self.bundle = bundle
        self.scene = scene ?? moment.scene
        self.plain = plain
    }
}

/// The words every layout shares.
enum NowWords {
    /// "11:30", without AM or PM: for the big clock, where the hour makes it plain.
    static func clock(_ date: Date) -> String {
        date.formatted(Date.FormatStyle().hour(.defaultDigits(amPM: .omitted)).minute(.twoDigits))
    }

    /// "11:30 AM", or "11:30" on a 24-hour clock.
    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    static func weekday(_ date: Date) -> String {
        date.formatted(Date.FormatStyle().weekday(.abbreviated))
    }

    /// "Fri 20".
    static func day(_ date: Date) -> String {
        date.formatted(Date.FormatStyle().weekday(.abbreviated).day())
    }

    /// The line beside Now: how long you have (components/Next.tsx).
    static func context(_ m: WidgetMoment) -> String {
        switch m.context {
        case .until(let end): return "Until \(time(end))"
        case .busyUntil(let end): return "Busy until \(time(end))"
        case .freeUntil(let start): return "Free until \(time(start))"
        case .restOfDay: return "Free for the rest of your day"
        case .none: return m.now.map { WidgetText.duration($0.minutes) } ?? ""
        }
    }

    /// The short form, for the smallest widget: when it ends, or how long it takes.
    static func shortContext(_ m: WidgetMoment) -> String {
        if case .until(let end) = m.context { return clock(end) }
        guard let now = m.now else { return "" }
        // "As of Fri" leaves no room for "Urgent · ".
        if m.stale { return WidgetText.compactDuration(now.minutes) }
        return now.priority == 1 ? "Urgent · \(WidgetText.compactDuration(now.minutes))" : WidgetText.duration(now.minutes)
    }

    /// "Urgent · 1 h", or just "1 h".
    static func meta(_ item: WidgetSnapshot.Item) -> String {
        item.priority == 1 ? "Urgent · \(WidgetText.duration(item.minutes))" : WidgetText.duration(item.minutes)
    }

    /// What the clock beside the window says, and the word under it.
    static func clockFace(_ m: WidgetMoment) -> (big: String, small: String) {
        switch m.context {
        case .until(let end): return (clock(end), "Ends")
        case .busyUntil(let end): return (clock(end), "Busy until")
        case .freeUntil(let start): return (clock(start), "Free until")
        case .restOfDay: return ("Free", "Rest of the day")
        case .none: return (day(m.date), "")
        }
    }

    /// Now's label: Now, or when the planner was last open if that was a while ago.
    static func label(_ m: WidgetMoment) -> String {
        if m.stale, let at = m.snapshot?.at { return "As of \(weekday(at))" }
        return m.allClear ? "All clear" : "Now"
    }

    /// Today's tally for a ticket's corner: "2 of 7 done", or the date.
    static func tally(_ m: WidgetMoment) -> String {
        if let t = m.today, t.total > 0 { return "\(t.done) of \(t.total) done" }
        return day(m.date)
    }
}

// MARK: - The widget

struct NowWidgetView: View {
    let model: NowModel
    /// Set by the gallery; a widget reads its own.
    var family: WidgetFamily?
    /// The gallery draws the background itself; a widget hands it to the system.
    var drawsBackground = false

    @Environment(\.widgetFamily) private var widgetFamily
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.showsWidgetContainerBackground) private var showsBackground
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetContentMargins) private var margins

    private var size: WidgetFamily { family ?? widgetFamily }
    /// The system's margin, or the usual 16 in a still picture.
    private var pad: CGFloat { margins.leading > 1 ? margins.leading : 16 }
    private var plain: Bool { model.plain || renderingMode != .fullColor || (!showsBackground && !drawsBackground) }

    private var palette: WidgetPalette {
        if plain { return .plain }
        let look = model.moment.snapshot?.look ?? .standard
        return scheme == .dark ? .of(look.dark, accent: look.accentDark) : .of(look.light, accent: look.accentLight)
    }

    private var window: Bool { model.style == .window && !plain }

    var body: some View {
        switch size {
        case .accessoryRectangular: LockRectangle(model: model)
        case .accessoryCircular: LockCircle(model: model)
        case .accessoryInline: LockInline(model: model)
        default: home
        }
    }

    @ViewBuilder private var home: some View {
        let content = layout
            .widgetURL(model.moment.now.flatMap { DeepLink.taskURL($0.id) })
        if drawsBackground {
            ZStack {
                background
                content
            }
        } else {
            content.containerBackground(for: .widget) { background }
        }
    }

    @ViewBuilder private var layout: some View {
        switch (size, window) {
        case (.systemSmall, true): WindowSmall(model: model, pad: pad)
        case (.systemMedium, true): WindowMedium(model: model, pad: pad)
        case (.systemLarge, true), (.systemExtraLarge, true): WindowLarge(model: model, pad: pad)
        case (.systemMedium, false): ThemeMedium(model: model, p: palette, pad: pad)
        case (.systemLarge, false), (.systemExtraLarge, false): ThemeLarge(model: model, p: palette, pad: pad)
        default: ThemeSmall(model: model, p: palette, pad: pad)
        }
    }

    @ViewBuilder private var background: some View {
        if plain {
            Color.clear
        } else if window {
            ZStack {
                model.scene.image(sceneSize, bundle: model.bundle).resizable().scaledToFill()
                LinearGradient(colors: model.scene.shade, startPoint: .top, endPoint: .center)
                if model.moment.now == nil && sceneSize != .large {
                    // Nothing to do: the words sit low on the view, over the fields.
                    LinearGradient(colors: [.black.opacity(0), .black.opacity(0.5)], startPoint: UnitPoint(x: 0.5, y: 0.35), endPoint: .bottom)
                } else if sceneSize == .medium {
                    // Behind the clock beside the ticket.
                    EllipticalGradient(colors: [.black.opacity(0.32), .black.opacity(0)], center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                        .frame(width: 286, height: 140)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .offset(x: -143, y: 70)
                }
                // Under a dark Home Screen, a touch of dusk over the view.
                if scheme == .dark { Color.black.opacity(0.14) }
            }
        } else {
            ZStack {
                LinearGradient(colors: [palette.top, palette.bottom], startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [palette.glow, palette.glow.opacity(0)], center: .topTrailing, startRadius: 0, endRadius: 220)
            }
        }
    }

    private var sceneSize: SceneSize {
        switch size {
        case .systemSmall: return .small
        case .systemMedium: return .medium
        default: return .large
        }
    }
}

// MARK: - The window: a ticket over the view

private let onSky = Color.white
private let skyShadow = Color(red: 5 / 255, green: 20 / 255, blue: 50 / 255).opacity(0.55)

/// The label across the top of the window: the lamp, Now, and what's beside it.
private struct SkyLabel: View {
    let m: WidgetMoment
    var trailing: String = ""

    var body: some View {
        HStack(spacing: 7) {
            Lamp(color: m.stale ? Color.white.opacity(0.6) : Color(rgb: 0xFFE7A8), glow: !m.stale)
            Text(NowWords.label(m)).printed(10.5).lineLimit(1).fixedSize()
            Spacer(minLength: 4)
            Text(trailing).printed(10.5).lineLimit(1).minimumScaleFactor(0.7)
        }
        .foregroundStyle(onSky.opacity(0.92))
        .shadow(color: skyShadow, radius: 4, y: 1)
    }
}

/// The message on the glass when there's no task: nothing to do, or nothing from the app yet.
private struct SkyNote: View {
    let m: WidgetMoment
    var big: CGFloat = 17
    var small: CGFloat = 12.5
    var long = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(m.snapshot == nil ? "Open Life is short" : "Nothing waiting.")
                .font(.geist(big, .semibold)).tracking(-big * 0.02)
            Text(m.snapshot == nil ? "Your next task shows up here." : long ? "Dump the next thing into the app when it comes." : "Enjoy the view.")
                .font(.geist(small, .medium)).opacity(0.9)
        }
        .foregroundStyle(onSky)
        .shadow(color: Color(red: 5 / 255, green: 20 / 255, blue: 50 / 255).opacity(0.7), radius: 6, y: 1)
        .lineLimit(2)
    }
}

/// Paper behind a ticket's contents, bitten at its tear line.
private struct TicketPaper: ViewModifier {
    var notch: CGFloat
    var fromBottom = false
    var radius: CGFloat = 6

    func body(content: Content) -> some View {
        content.background {
            GeometryReader { g in
                TicketShape(notch: fromBottom ? g.size.height - notch : notch, radius: radius)
                    .fill(Paper.paper)
                    .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
            }
        }
    }
}

private extension View {
    func ticket(notch: CGFloat, fromBottom: Bool = false, radius: CGFloat = 6) -> some View {
        modifier(TicketPaper(notch: notch, fromBottom: fromBottom, radius: radius))
    }
}

/// A goal, or what a task is, in the ticket's ink.
private struct TicketGoal: View {
    let item: WidgetSnapshot.Item
    var size: CGFloat = 11.5

    var body: some View {
        HStack(spacing: 6) {
            GoalDot(color: Color(hex: item.color), ring: Paper.muted)
            Text(item.goal ?? NowWords.meta(item)).font(.geist(size, .medium)).foregroundStyle(Paper.muted).lineLimit(1)
        }
    }
}

struct WindowSmall: View {
    let model: NowModel
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        if let now = m.now {
            VStack(spacing: 0) {
                SkyLabel(m: m, trailing: NowWords.shortContext(m))
                    .padding(.horizontal, pad).padding(.top, pad - 2).padding(.bottom, 10)
                VStack(alignment: .leading, spacing: 0) {
                    Text(now.title)
                        .font(.geist(16.5, .semibold)).tracking(-0.4)
                        .foregroundStyle(Paper.ink)
                        .lineLimit(3).minimumScaleFactor(0.85)
                        .privacySensitive()
                    Spacer(minLength: 6)
                    TicketGoal(item: now)
                    if let slot = m.slot {
                        SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: Paper.ink, track: Paper.track, live: model.live)
                            .padding(.top, 8)
                    }
                }
                .padding(.horizontal, 12).padding(.top, 11).padding(.bottom, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .ticket(notch: 28, radius: 5)
                .padding([.horizontal, .bottom], pad / 2)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                SkyLabel(m: m)
                Spacer()
                SkyNote(m: m)
            }
            .padding(pad)
        }
    }
}

struct WindowMedium: View {
    let model: NowModel
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        if let now = m.now {
            GeometryReader { g in
                HStack(spacing: 0) {
                    clockSide.frame(width: g.size.width * 0.385)
                    ticket(now).frame(width: g.size.width * 0.615)
                }
            }
            .padding([.vertical, .trailing], pad / 2)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                SkyLabel(m: m, trailing: NowWords.day(m.date))
                Spacer()
                SkyNote(m: m, big: 20, small: 13, long: true)
            }
            .padding(pad)
        }
    }

    private var clockSide: some View {
        let face = NowWords.clockFace(m)
        return VStack(alignment: .leading, spacing: 0) {
            SkyLabel(m: m)
            Spacer(minLength: 4)
            Text(face.big).font(.geistMono(24, .semibold)).tracking(-0.7).lineLimit(1).minimumScaleFactor(0.6)
            if !face.small.isEmpty {
                Text(face.small).printed(9.5).lineLimit(1).minimumScaleFactor(0.8).padding(.top, 4)
            }
        }
        .foregroundStyle(onSky)
        .shadow(color: skyShadow, radius: 6, y: 1)
        .padding(.leading, pad).padding(.trailing, 6).padding(.vertical, pad / 2 + 2)
        .frame(maxHeight: .infinity, alignment: .leading)
    }

    private func ticket(_ now: WidgetSnapshot.Item) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("Next task").printed(9.5)
                Spacer(minLength: 4)
                Text(NowWords.meta(now)).printed(9.5).foregroundStyle(now.priority == 1 ? Paper.red : Paper.muted)
            }
            .foregroundStyle(Paper.muted)
            .lineLimit(1)
            Text(now.title)
                .font(.geist(18, .semibold)).tracking(-0.45)
                .foregroundStyle(Paper.ink)
                .lineLimit(2).minimumScaleFactor(0.85)
                .privacySensitive()
                .padding(.top, 8)
            if now.goal != nil { TicketGoal(item: now).padding(.top, 5) }
            Spacer(minLength: 4)
            if let slot = m.slot {
                SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: Paper.ink, track: Paper.track, live: model.live)
                    .padding(.bottom, 9)
            }
            Perforation().padding(.horizontal, -14)
            NextRow(m: m).frame(height: 16).padding(.top, 9)
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ticket(notch: 35.75, fromBottom: true)
    }
}

/// What comes after Now, on one line: its time if it's on the calendar, then what it is.
private struct NextRow: View {
    let m: WidgetMoment
    var ink: Color = Paper.ink
    var muted: Color = Paper.muted

    var body: some View {
        HStack(spacing: 8) {
            if let next = m.next {
                Text(next.start == nil ? "Then" : "Next").printed(9.5).foregroundStyle(muted)
                if let start = next.start {
                    Text(NowWords.clock(start)).font(.geistMono(12, .semibold)).tracking(-0.3).foregroundStyle(ink)
                }
                Text(next.title).font(.geist(12, .medium)).foregroundStyle(ink).lineLimit(1).privacySensitive()
                Spacer(minLength: 4)
                Text(WidgetText.compactDuration(next.minutes)).font(.geistMono(11)).foregroundStyle(muted)
            } else {
                Text("Nothing after this").printed(9.5).foregroundStyle(muted)
                Spacer(minLength: 0)
            }
        }
    }
}

struct WindowLarge: View {
    let model: NowModel
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        GeometryReader { g in
            VStack(spacing: 0) {
                sky.padding(.horizontal, pad).padding(.top, pad - 2)
                Spacer(minLength: 8)
                LargeTicket(model: model)
                    .frame(height: max(176, g.size.height * 0.52))
                    .padding([.horizontal, .bottom], pad / 2)
            }
        }
    }

    @ViewBuilder private var sky: some View {
        if let now = m.now {
            VStack(alignment: .leading, spacing: 0) {
                SkyLabel(m: m, trailing: NowWords.context(m))
                Text(now.title)
                    .font(.geist(26, .semibold)).tracking(-0.65)
                    .foregroundStyle(onSky)
                    .lineLimit(2).minimumScaleFactor(0.75)
                    .frame(maxWidth: 300, alignment: .leading)
                    .shadow(color: skyShadow, radius: 10, y: 1)
                    .privacySensitive()
                    .padding(.top, 10)
                if let goal = now.goal {
                    HStack(spacing: 6) {
                        GoalDot(color: Color(hex: now.color), ring: onSky)
                            .overlay(Circle().strokeBorder(onSky.opacity(0.85), lineWidth: 1.2))
                        Text(goal).font(.geist(12, .medium)).lineLimit(1)
                    }
                    .foregroundStyle(onSky.opacity(0.94))
                    .shadow(color: skyShadow, radius: 6, y: 1)
                    .padding(.top, 8)
                }
                if let slot = m.slot {
                    SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: onSky, track: onSky.opacity(0.28), live: model.live)
                        .padding(.top, 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                SkyLabel(m: m, trailing: NowWords.day(m.date))
                SkyNote(m: m, big: 24, small: 15, long: true).padding(.top, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The large window's ticket: today's outcomes above the tear, and the rest of today, like a departures board, below.
private struct LargeTicket: View {
    let model: NowModel
    private var m: WidgetMoment { model.moment }
    /// From the top to the tear line.
    private static let tear: CGFloat = 92

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text(m.outcomes == nil ? "Today" : "Today’s outcomes").printed(9.5)
                    Spacer(minLength: 4)
                    Text(NowWords.tally(m)).printed(9.5)
                }
                .foregroundStyle(Paper.muted)
                .lineLimit(1)
                OutcomeRows(m: m, ink: Paper.ink, muted: Paper.muted, track: Paper.track, rows: 2)
                    .padding(.top, 10)
            }
            .padding(.horizontal, 14).padding(.top, 13)
            .frame(height: Self.tear - 0.75, alignment: .top)
            Perforation()
            DepartureRows(m: m, ink: Paper.ink, muted: Paper.muted, rows: 3)
                .padding(.horizontal, 14).padding(.top, 11)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ticket(notch: Self.tear, radius: 7)
    }
}

/// Today's outcomes, a line each, with today's steps; or that today isn't planned, and the way to plan it.
private struct OutcomeRows: View {
    let m: WidgetMoment
    let ink: Color
    let muted: Color
    let track: Color
    var rows = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let outcomes = m.outcomes, !outcomes.isEmpty {
                ForEach(Array(outcomes.prefix(rows).enumerated()), id: \.offset) { _, o in
                    HStack(spacing: 8) {
                        GoalDot(color: Color(hex: o.color), ring: muted)
                        Text(o.text).font(.geist(12.5)).foregroundStyle(ink).lineLimit(1).privacySensitive()
                        Spacer(minLength: 4)
                        if o.steps > 0 { Steps(done: o.done, total: o.steps, on: ink, off: track) }
                    }
                }
            } else if m.snapshot == nil {
                Text("Today’s outcomes and the rest of your day show up here.").font(.geist(12.5)).foregroundStyle(muted).lineLimit(2)
            } else {
                Text("Today isn’t planned yet.").font(.geist(12.5, .medium)).foregroundStyle(ink).lineLimit(1)
                Link(destination: WidgetShared.planURL) {
                    HStack(spacing: 4) {
                        Text("Plan it with Claude").font(.geist(12.5, .medium))
                        Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(muted)
                }
            }
        }
    }
}

/// The rest of today on the calendar, soonest first, like a departures board; then what's after Now on the backlog.
private struct DepartureRows: View {
    let m: WidgetMoment
    let ink: Color
    let muted: Color
    var rows = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(m.later.prefix(rows)) { item in
                row(item)
            }
            if m.later.count < rows, let next = m.next, next.start == nil {
                row(next)
            }
            if m.later.isEmpty && (m.next == nil || m.next?.start != nil) {
                Text(m.snapshot == nil ? "" : "Nothing else on the calendar today.").font(.geist(12.5)).foregroundStyle(muted)
            }
        }
    }

    @ViewBuilder private func row(_ item: WidgetSnapshot.Item) -> some View {
        let line = HStack(spacing: 8) {
            Group {
                if let start = item.start {
                    Text(NowWords.clock(start)).font(.geistMono(12, .semibold)).tracking(-0.3)
                } else {
                    Text("Then").printed(9.5).foregroundStyle(muted)
                }
            }
            .frame(width: 42, alignment: .leading)
            Text(item.title).font(.geist(12.5, item.isEvent ? .regular : .medium)).lineLimit(1).privacySensitive()
                .foregroundStyle(item.isEvent ? muted : ink)
            Spacer(minLength: 4)
            Text(WidgetText.compactDuration(item.minutes)).font(.geistMono(11)).foregroundStyle(muted)
        }
        .foregroundStyle(ink)
        if let url = DeepLink.taskURL(item.id), !item.isEvent {
            Link(destination: url) { line }
        } else {
            line
        }
    }
}

// MARK: - The theme: the planner's own colours

/// Now's label in a theme: the accent's dot, Now, and what's beside it.
private struct ThemeLabel: View {
    let m: WidgetMoment
    let p: WidgetPalette
    var trailing: String = ""

    var body: some View {
        HStack(spacing: 7) {
            Lamp(color: m.stale ? p.faint : p.accent, glow: p.dark && !m.stale).widgetAccentable()
            Text(NowWords.label(m)).printed(10.5).lineLimit(1).fixedSize()
            Spacer(minLength: 4)
            Text(trailing).printed(10.5).lineLimit(1).minimumScaleFactor(0.7)
        }
        .foregroundStyle(p.muted)
    }
}

private struct ThemeGoal: View {
    let item: WidgetSnapshot.Item
    let p: WidgetPalette

    var body: some View {
        HStack(spacing: 6) {
            GoalDot(color: p.accent == .white ? nil : Color(hex: item.color), ring: p.muted)
            Text(item.goal ?? NowWords.meta(item)).font(.geist(12, .medium)).foregroundStyle(p.muted).lineLimit(1)
        }
    }
}

private struct ThemeNote: View {
    let m: WidgetMoment
    let p: WidgetPalette
    var big: CGFloat = 19

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(m.snapshot == nil ? "Open Life is short" : "All clear.").font(.geist(big, .semibold)).tracking(-big * 0.022)
                .foregroundStyle(p.ink).widgetAccentable()
            Text(m.snapshot == nil ? "Your next task shows up here." : "Dump the next thing into the app.")
                .font(.geist(12.5)).foregroundStyle(p.muted)
        }
        .lineLimit(2)
    }
}

struct ThemeSmall: View {
    let model: NowModel
    let p: WidgetPalette
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ThemeLabel(m: m, p: p, trailing: NowWords.shortContext(m))
            if let now = m.now {
                Text(now.title)
                    .font(.geist(19, .semibold)).tracking(-0.45)
                    .foregroundStyle(p.ink)
                    .lineLimit(3).minimumScaleFactor(0.8)
                    .privacySensitive()
                    .widgetAccentable()
                    .padding(.top, 10)
                Spacer(minLength: 6)
                ThemeGoal(item: now, p: p)
                if let slot = m.slot {
                    SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: p.accent, track: p.track, live: model.live)
                        .widgetAccentable()
                        .padding(.top, 9)
                }
            } else {
                Spacer()
                ThemeNote(m: m, p: p, big: 18)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(pad)
    }
}

struct ThemeMedium: View {
    let model: NowModel
    let p: WidgetPalette
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ThemeLabel(m: m, p: p, trailing: m.now == nil ? NowWords.day(m.date) : NowWords.context(m))
            if let now = m.now {
                Text(now.title)
                    .font(.geist(22, .semibold)).tracking(-0.5)
                    .foregroundStyle(p.ink)
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .privacySensitive()
                    .widgetAccentable()
                    .padding(.top, 9)
                if now.goal != nil { ThemeGoal(item: now, p: p).padding(.top, 6) }
                Spacer(minLength: 6)
                if let slot = m.slot {
                    SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: p.accent, track: p.track, live: model.live)
                        .widgetAccentable()
                        .padding(.bottom, 10)
                }
                NextRow(m: m, ink: p.ink, muted: p.muted).frame(height: 16)
            } else {
                Spacer()
                ThemeNote(m: m, p: p, big: 20)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(pad)
    }
}

struct ThemeLarge: View {
    let model: NowModel
    let p: WidgetPalette
    let pad: CGFloat
    private var m: WidgetMoment { model.moment }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(m.date.formatted(Date.FormatStyle().weekday(.wide).day().month(.wide))).font(.geist(12, .medium))
                Spacer(minLength: 4)
                if let t = m.today, t.total > 0 { Text("\(t.done) of \(t.total) done").font(.geist(12, .medium)) }
            }
            .foregroundStyle(p.muted)
            Rectangle().fill(p.hair).frame(height: 1).padding(.vertical, 12)
            ThemeLabel(m: m, p: p, trailing: m.now == nil ? "" : NowWords.context(m))
            if let now = m.now {
                Text(now.title)
                    .font(.geist(24, .semibold)).tracking(-0.55)
                    .foregroundStyle(p.ink)
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .privacySensitive()
                    .widgetAccentable()
                    .padding(.top, 8)
                if now.goal != nil { ThemeGoal(item: now, p: p).padding(.top, 6) }
                if let slot = m.slot {
                    SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: p.accent, track: p.track, live: model.live)
                        .widgetAccentable()
                        .padding(.top, 12)
                }
            } else {
                ThemeNote(m: m, p: p, big: 22).padding(.top, 8)
            }
            Text(m.outcomes == nil ? "Today" : "Today’s outcomes").printed(9.5).foregroundStyle(p.muted).padding(.top, 18)
            OutcomeRows(m: m, ink: p.ink, muted: p.muted, track: p.track, rows: 2).padding(.top, 8)
            Text("Later today").printed(9.5).foregroundStyle(p.muted).padding(.top, 16)
            DepartureRows(m: m, ink: p.ink, muted: p.muted, rows: 3).padding(.top, 8)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(pad)
    }
}

// MARK: - The lock screen

struct LockRectangle: View {
    let model: NowModel
    private var m: WidgetMoment { model.moment }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let now = m.now {
                HStack(spacing: 4) {
                    Image(systemName: m.live ? "circle.fill" : "circle").font(.system(size: 6, weight: .bold))
                    Text(m.live ? NowWords.context(m) : NowWords.label(m)).font(.geist(11, .semibold)).textCase(.uppercase).lineLimit(1)
                }
                .foregroundStyle(.secondary)
                Text(now.title).font(.geist(15, .semibold)).lineLimit(2).privacySensitive().widgetAccentable()
                if let slot = m.slot {
                    SlotBar(slot: slot, remaining: m.remaining ?? 0, fill: .primary, track: Color.secondary.opacity(0.35), live: model.live)
                        .padding(.top, 3)
                } else if let goal = now.goal {
                    Text(goal).font(.geist(11)).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Text(m.snapshot == nil ? "Life is short" : "All clear").font(.geist(15, .semibold)).widgetAccentable()
                Text(m.snapshot == nil ? "Open the app to begin." : "Nothing waiting.").font(.geist(12)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(m.now.flatMap { DeepLink.taskURL($0.id) })
        .containerBackground(for: .widget) { Color.clear }
    }
}

struct LockCircle: View {
    let model: NowModel
    private var m: WidgetMoment { model.moment }

    var body: some View {
        Group {
            if let slot = m.slot {
                Gauge(value: m.remaining ?? 0) {
                    Image(systemName: "hourglass")
                } currentValueLabel: {
                    Text(NowWords.clock(slot.upperBound)).font(.geist(12, .semibold)).minimumScaleFactor(0.6)
                }
                .gaugeStyle(.accessoryCircularCapacity)
            } else if let t = m.today, t.total > 0 {
                Gauge(value: Double(min(t.done, t.total)), in: 0...Double(t.total)) {
                    Text("Done")
                } currentValueLabel: {
                    Text("\(t.done)/\(t.total)").font(.geist(13, .semibold)).minimumScaleFactor(0.6)
                }
                .gaugeStyle(.accessoryCircular)
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: m.allClear ? "checkmark" : "circle.dotted").font(.system(size: 18, weight: .semibold))
                }
            }
        }
        .widgetAccentable()
        .widgetURL(m.now.flatMap { DeepLink.taskURL($0.id) })
        .containerBackground(for: .widget) { Color.clear }
    }
}

struct LockInline: View {
    let model: NowModel
    private var m: WidgetMoment { model.moment }

    var body: some View {
        Group {
            if let now = m.now {
                if case .until(let end) = m.context {
                    Text("\(now.title) · \(NowWords.clock(end))")
                } else {
                    Text(now.title)
                }
            } else {
                Text(m.snapshot == nil ? "Life is short" : "All clear")
            }
        }
        .privacySensitive()
        .widgetURL(m.now.flatMap { DeepLink.taskURL($0.id) })
        .containerBackground(for: .widget) { Color.clear }
    }
}
