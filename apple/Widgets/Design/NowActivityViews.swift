import AppIntents
import LifeIsShortCore
import SwiftUI
import WidgetKit

// The Lock Screen's Now (a Live Activity, Widgets/Live): the one thing to do now on the Lock Screen and in the Dynamic
// Island, in the widget's two looks. The window: the view out of the train for the time of day, the clock on the glass
// and the task on a ticket. Your theme: the planner's Now card, made small. Shared by the widget extension, which draws
// the activity, and the app, which draws it for CI (iOS/WidgetGallery.swift).
//
// Only countdowns and bars move between updates. Past its turn iOS marks the activity stale and these views draw what
// Now became then (LiveNowState.then), honestly labelled: the lamp goes out, the clock counts up from the turn and
// Refresh grows big.

/// What the activity draws, and how.
struct NowActivityModel {
    var state: LiveNowState
    /// iOS has marked it stale: its turn has come.
    var isStale: Bool
    /// A running activity, whose clocks and bars run by themselves; false for a still picture (the app's gallery).
    var live: Bool
    /// Where the pictures and type are: the widget extension's bundle.
    var bundle: Bundle
    /// The moment a still picture shows. A running activity's clocks read the time themselves.
    var date: Date

    init(state: LiveNowState, isStale: Bool, live: Bool, bundle: Bundle, date: Date? = nil) {
        self.state = state
        self.isStale = isStale
        self.live = live
        self.bundle = bundle
        self.date = date ?? state.made
    }

    /// The step on show: `then` past the turn.
    var step: LiveNowState.Step { state.showing(isStale: isStale) }
    /// The day's hours are over.
    var over: Bool { state.now.kind == .over || step.kind == .over }
    /// Past its turn with nothing newer: what it shows is probably, not certainly, Now.
    var outOfDate: Bool { isStale && !over }
    var task: LiveNowState.Task? { over ? nil : step.task }
    var window: Bool { state.style == .window }
    var scene: WidgetScene { WidgetScene(rawValue: step.scene) ?? .meadow }
    /// What it's running down: a slot or a meeting.
    var slot: ClosedRange<Date>? { outOfDate ? nil : step.slot }
    /// Tapping it opens the task in the app.
    var url: URL? { task.flatMap { $0.isEvent ? nil : DeepLink.taskURL($0.id) } }
}

/// The words the activity's layouts share.
enum ActivityWords {
    static func label(_ m: NowActivityModel, theme: Bool) -> String {
        if m.over { return "Day’s end" }
        if m.outOfDate { return theme ? "Probably now" : "Out of date" }
        switch m.step.kind {
        case .busy: return "In a meeting"
        case .clear: return "All clear"
        default: return "Now"
        }
    }

    /// How long you have, in a line: "Until 11:30", "Free until 14:30".
    static func context(_ step: LiveNowState.Step) -> String {
        let at = step.until.map(NowWords.clock) ?? ""
        switch step.kind {
        case .slot: return "Until \(at)"
        case .busy: return "Busy until \(at)"
        case .free: return "Free until \(at)"
        case .rest: return "Rest of the day"
        default: return ""
        }
    }

    /// What happened at the turn, for an activity past it: "Slot ended 11:30".
    static func turned(_ m: NowActivityModel) -> String {
        let at = NowWords.clock(m.state.turn)
        switch m.state.why {
        case .slotEnded: return "Slot ended \(at)"
        case .meetingEnded: return "Meeting ended \(at)"
        case .slotStarts: return "Slot began \(at)"
        default: return "Since \(at)"
        }
    }

    /// The same, saying what it was: "Fix the onboarding crash ended 11:30".
    static func turnedLine(_ m: NowActivityModel) -> String {
        let at = NowWords.clock(m.state.turn)
        switch m.state.why {
        case .slotEnded: return m.state.now.task?.title.map { "\($0) ended \(at)" } ?? "Your slot ended \(at)"
        case .meetingEnded: return m.state.now.task?.title.map { "\($0) ended \(at)" } ?? "Your meeting ended \(at)"
        case .slotStarts: return m.state.then.task?.title.map { "\($0) began \(at)" } ?? "A slot began \(at)"
        default: return "Changed at \(at)"
        }
    }

    /// "7 of 7 done", or nothing.
    static func tally(_ state: LiveNowState) -> String {
        guard let t = state.today, t.total > 0 else { return "" }
        return "\(t.done) of \(t.total) done"
    }

    /// "Urgent · 1 h", or "45 min".
    static func meta(_ task: LiveNowState.Task) -> String {
        task.priority == 1 && !task.isEvent ? "Urgent · \(WidgetText.duration(task.minutes))" : WidgetText.duration(task.minutes)
    }

    /// Its goal, or what it is.
    static func goal(_ task: LiveNowState.Task) -> String {
        task.goal ?? (task.isEvent ? "Google Calendar" : "Off-goal")
    }

    static func urgent(_ task: LiveNowState.Task) -> Bool { task.priority == 1 && !task.isEvent }

    /// A still picture's clock: whole minutes.
    static func minutes(from a: Date, to b: Date) -> String {
        "\(max(0, Int((b.timeIntervalSince(a) / 60).rounded(.up)))) min"
    }

    /// The last word, and the line under it, with no task to show.
    static func note(_ m: NowActivityModel, window: Bool) -> (big: String, small: String) {
        if m.over { return ("That’s the day.", "It starts again when you open the planner.") }
        return window ? ("Nothing waiting.", "Enjoy the view.") : ("All clear.", "Dump the next thing into the app.")
    }
}

// MARK: - Clocks: the only words that change between updates

/// What's left of a slot or meeting, counting down by itself: in minutes from iOS 18, minutes and seconds before.
struct LeftClock: View {
    let slot: ClosedRange<Date>
    let live: Bool
    let at: Date

    var body: some View {
        if live {
            if #available(iOS 18.0, *) {
                Text(.currentDate, format: .offset(to: slot.upperBound, allowedFields: [.minute], maxFieldCount: 1, sign: .never))
            } else {
                Text(timerInterval: slot, countsDown: true, showsHours: false)
            }
        } else {
            Text(ActivityWords.minutes(from: at, to: slot.upperBound))
        }
    }
}

/// How long since the turn, counting up: "+12 min".
struct SinceClock: View {
    let since: Date
    let live: Bool
    let at: Date

    var body: some View {
        HStack(spacing: 0) {
            Text("+")
            if live {
                if #available(iOS 18.0, *) {
                    Text(.currentDate, format: .offset(to: since, allowedFields: [.minute], maxFieldCount: 1, sign: .never))
                } else {
                    Text(timerInterval: since...since.addingTimeInterval(12 * 3600), countsDown: false, showsHours: false)
                }
            } else {
                Text(ActivityWords.minutes(from: since, to: at))
            }
        }
    }
}

/// A slot's ring, draining as it runs, around its goal's colour.
struct SlotRing: View {
    let slot: ClosedRange<Date>
    var color: Color
    var track: Color
    var dot: Color?
    var size: CGFloat
    let live: Bool
    let at: Date

    private var line: CGFloat { max(2, size * 0.12) }

    var body: some View {
        ZStack {
            if live {
                ProgressView(timerInterval: slot, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .progressViewStyle(.circular)
                    .tint(color)
            } else {
                let total = slot.upperBound.timeIntervalSince(slot.lowerBound)
                let left = total > 0 ? min(1, max(0, slot.upperBound.timeIntervalSince(at) / total)) : 0
                Circle().stroke(track, lineWidth: line)
                Circle().trim(from: 0, to: left)
                    .stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            if let dot { Circle().fill(dot).frame(width: size * 0.32, height: size * 0.32) }
        }
        .frame(width: size, height: size)
    }
}

/// Refresh's mark.
private struct RefreshMark: View {
    var size: CGFloat = 12
    var weight: Font.Weight = .bold

    var body: some View {
        Image(systemName: "arrow.clockwise").font(.system(size: size, weight: weight)).accessibilityHidden(true)
    }
}

/// A bar in place of words, when task names are hidden.
private struct Hidden: View {
    var width: CGFloat
    var height: CGFloat
    var color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 3.5).fill(color).frame(width: width, height: height)
            .accessibilityLabel("Hidden")
    }
}

// MARK: - The Lock Screen

/// The Lock Screen's (and the Notification Centre's, and StandBy's) presentation, in the chosen look.
struct NowActivityLockView: View {
    let model: NowActivityModel
    @Environment(\.colorScheme) private var scheme

    private var palette: WidgetPalette {
        let look = model.state.look
        return scheme == .dark ? .of(look.dark, accent: look.accentDark) : .of(look.light, accent: look.accentLight)
    }

    var body: some View {
        Group {
            if model.window {
                ActivityLockWindow(m: model)
            } else {
                ActivityLockTheme(m: model, p: palette)
            }
        }
        .widgetURL(model.url)
        .activityBackgroundTint(model.window ? Color(rgb: 0x2A4F7A) : palette.bottom)
        .activitySystemActionForegroundColor(model.window ? .white : palette.muted)
    }
}

private let onSky = Color.white
private let skyShadow = Color(red: 5 / 255, green: 20 / 255, blue: 50 / 255).opacity(0.55)
private let lampLight = Color(rgb: 0xFFE7A8)

/// The window's lamp, out once the activity is past its turn or the day is over.
private struct WindowLamp: View {
    var on: Bool

    var body: some View {
        if on {
            Lamp(color: lampLight, glow: true)
        } else {
            Circle().strokeBorder(onSky.opacity(0.75), lineWidth: 1.5).frame(width: 7, height: 7).frame(width: 13, height: 13)
        }
    }
}

struct ActivityLockWindow: View {
    let m: NowActivityModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Group {
            if let task = m.task {
                HStack(spacing: 0) {
                    clock.frame(width: 143)
                    ticket(task).padding([.vertical, .trailing], 7)
                }
            } else {
                note
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .frame(height: m.task == nil ? 120 : 160)
        // A background, so the filled scene can't size the view and push the words off its edges.
        .background { background }
    }

    private var background: some View {
        ZStack {
            m.scene.image(.activity, bundle: m.bundle).resizable().scaledToFill()
            LinearGradient(colors: m.scene.shade, startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.55))
            if m.task != nil {
                // Behind the clock, so white type reads on any field.
                EllipticalGradient(colors: [.black.opacity(0.42), .black.opacity(0)], center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                    .frame(width: 300, height: 160)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .offset(x: -96, y: 70)
            } else {
                LinearGradient(colors: [.black.opacity(0), .black.opacity(0.38)], startPoint: UnitPoint(x: 0.5, y: 0.38), endPoint: .bottom)
            }
            if scheme == .dark { Color.black.opacity(0.14) }
        }
        .clipped()
    }

    /// The glass: the lamp, Now, and the clock.
    private var clock: some View {
        let step = m.step
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                WindowLamp(on: !m.outOfDate)
                // "In a meeting" doesn't fit beside Refresh; the caption below already says Busy.
                Text(m.step.kind == .busy && !m.outOfDate ? "Meeting" : ActivityWords.label(m, theme: false))
                    .printed(10.5).lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                if !m.outOfDate {
                    Button(intent: RefreshNowIntent()) {
                        RefreshMark(size: 13, weight: .semibold)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(onSky.opacity(0.2)))
                            .overlay(Circle().strokeBorder(onSky.opacity(0.38), lineWidth: 1))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Refresh")
                    .padding(.vertical, -14)
                    .padding(.trailing, -8)
                }
            }
            .frame(height: 16)
            Spacer(minLength: 4)
            VStack(alignment: .leading, spacing: 6) {
                Text(caption).printed(10.5).lineLimit(1).minimumScaleFactor(0.8)
                big(step)
                    .font(.geistMono(28, .semibold)).tracking(-0.8)
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .opacity(m.outOfDate ? 0.78 : 1)
            }
        }
        .foregroundStyle(onSky)
        .shadow(color: skyShadow, radius: 6, y: 1)
        .padding(.leading, 14).padding(.trailing, 8).padding(.top, 14).padding(.bottom, 15)
    }

    private var caption: String {
        if m.outOfDate { return ActivityWords.turned(m) }
        let step = m.step
        let at = step.until.map(NowWords.clock) ?? ""
        switch step.kind {
        case .slot: return "Left · ends \(at)"
        case .busy: return "Busy · ends \(at)"
        case .free: return "Free until"
        default: return "Rest of the day"
        }
    }

    @ViewBuilder private func big(_ step: LiveNowState.Step) -> some View {
        if m.outOfDate {
            SinceClock(since: m.state.turn, live: m.live, at: m.date)
        } else if let slot = m.slot {
            LeftClock(slot: slot, live: m.live, at: m.date)
        } else if step.kind == .free, let until = step.until {
            Text(NowWords.clock(until))
        } else {
            Text("Free")
        }
    }

    private func ticket(_ task: LiveNowState.Task) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(m.outOfDate ? "Probably now" : task.isEvent ? "On your calendar" : "Next task").printed(10)
                Spacer(minLength: 4)
                Text(ActivityWords.meta(task)).printed(10).foregroundStyle(ActivityWords.urgent(task) ? Paper.red : Paper.muted)
            }
            .foregroundStyle(Paper.muted)
            .lineLimit(1)
            Group {
                if let title = task.title {
                    Text(title)
                        .font(.geist(18, task.isEvent ? .medium : .semibold)).tracking(-0.45)
                        .foregroundStyle(Paper.ink)
                        .lineLimit(2).minimumScaleFactor(0.85)
                        .privacySensitive()
                } else {
                    Hidden(width: 150, height: 13, color: Paper.ink.opacity(0.14)).padding(.top, 3)
                }
            }
            .padding(.top, 7)
            HStack(spacing: 6) {
                GoalDot(color: Color(hex: task.color), ring: Paper.muted)
                if m.state.hidden {
                    Hidden(width: 96, height: 9, color: Paper.ink.opacity(0.12))
                } else {
                    Text(ActivityWords.goal(task)).font(.geist(12, .medium)).foregroundStyle(Paper.muted).lineLimit(1).privacySensitive()
                }
                Spacer(minLength: 4)
                if let o = m.step.outcome { Steps(done: o.done, total: o.steps, on: Paper.ink, off: Paper.track) }
            }
            .frame(height: 14)
            .padding(.top, 6)
            Spacer(minLength: 0)
            if let slot = m.slot {
                SlotBar(slot: slot, remaining: remaining(slot), fill: m.step.kind == .busy ? Paper.muted : Paper.ink, track: Paper.track, live: m.live)
                    .padding(.bottom, 9)
            }
            Perforation().padding(.horizontal, -14)
            stub.frame(height: 34)
        }
        .padding(.horizontal, 14).padding(.top, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            GeometryReader { g in
                TicketShape(notch: g.size.height - 35.75, radius: 6)
                    .fill(Paper.paper)
                    .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
            }
        }
    }

    private func remaining(_ slot: ClosedRange<Date>) -> Double {
        let total = slot.upperBound.timeIntervalSince(slot.lowerBound)
        return total > 0 ? min(1, max(0, slot.upperBound.timeIntervalSince(m.date) / total)) : 0
    }

    /// Below the tear: what's next, or, past the turn, Refresh and when the planner last spoke.
    @ViewBuilder private var stub: some View {
        if m.outOfDate {
            HStack(spacing: 8) {
                Button(intent: RefreshNowIntent()) {
                    HStack(spacing: 6) {
                        RefreshMark(size: 10)
                        Text("Refresh").printed(10.5)
                    }
                    .foregroundStyle(Paper.red)
                    .padding(.leading, 8).padding(.trailing, 9)
                    .frame(height: 24)
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Paper.red, lineWidth: 1.5))
                    .frame(height: 34)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                Text("As of \(NowWords.clock(m.state.asOf))").font(.geistMono(11)).foregroundStyle(Paper.muted).lineLimit(1)
            }
        } else if let next = m.step.next {
            NextLine(next: next, hidden: m.state.hidden, ink: Paper.ink, muted: Paper.muted, size: 12, label: 10)
        } else {
            HStack {
                Text("Nothing after this").printed(10).foregroundStyle(Paper.muted)
                Spacer(minLength: 0)
            }
        }
    }

    /// No task: all clear, or the day's over.
    private var note: some View {
        let words = ActivityWords.note(m, window: true)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                WindowLamp(on: !m.over)
                Text(ActivityWords.label(m, theme: false)).printed(10.5)
                Spacer(minLength: 4)
                Text(ActivityWords.tally(m.state)).printed(10.5).lineLimit(1)
                if !m.over {
                    Button(intent: RefreshNowIntent()) {
                        RefreshMark(size: 13, weight: .semibold)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(onSky.opacity(0.2)))
                            .overlay(Circle().strokeBorder(onSky.opacity(0.38), lineWidth: 1))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Refresh")
                    .padding(.vertical, -14)
                    .padding(.trailing, -7)
                }
            }
            .frame(height: 16)
            Spacer(minLength: 4)
            Text(words.big).font(.geist(20, .semibold)).tracking(-0.4)
            Text(words.small).font(.geist(13, .medium)).opacity(0.92).padding(.top, 2).lineLimit(1).minimumScaleFactor(0.85)
        }
        .foregroundStyle(onSky)
        .shadow(color: skyShadow, radius: 8, y: 1)
        .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 15)
    }
}

/// What comes after Now, on one line: Next and its time, or Then for the backlog.
private struct NextLine: View {
    let next: LiveNowState.Entry
    let hidden: Bool
    let ink: Color
    let muted: Color
    var size: CGFloat = 12
    var label: CGFloat = 10

    var body: some View {
        HStack(spacing: 8) {
            Text(next.start == nil ? "Then" : "Next").printed(label).foregroundStyle(muted).fixedSize()
            if let start = next.start {
                Text(NowWords.clock(start)).font(.geistMono(size, .semibold)).tracking(-0.3).foregroundStyle(ink).fixedSize()
            }
            if let title = next.title {
                Text(title).font(.geist(size, .medium)).foregroundStyle(ink).lineLimit(1).privacySensitive()
            } else if hidden {
                RoundedRectangle(cornerRadius: 3.5).fill(ink.opacity(0.12)).frame(maxWidth: 84).frame(height: 9)
                    .accessibilityLabel("Hidden")
            }
            Spacer(minLength: 4)
            Text(WidgetText.compactDuration(next.minutes)).font(.geistMono(11)).foregroundStyle(muted).fixedSize()
        }
    }
}

struct ActivityLockTheme: View {
    let m: NowActivityModel
    let p: WidgetPalette

    private var raised: Color { p.dark ? Color(rgb: 0x141A22) : p.top }
    private var hair2: Color { p.ink.opacity(p.dark ? 0.16 : 0.2) }
    private var redact: Color { p.ink.opacity(p.dark ? 0.14 : 0.1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if let task = m.task {
                taskRows(task)
            } else {
                let words = ActivityWords.note(m, window: false)
                Spacer(minLength: 4)
                Text(words.big).font(.geist(20, .semibold)).tracking(-0.45).foregroundStyle(p.ink)
                Text(words.small).font(.geist(12.5)).foregroundStyle(p.muted).padding(.top, 2).lineLimit(1)
            }
        }
        .padding(14)
        .frame(height: m.task == nil ? 96 : 148)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                LinearGradient(colors: [p.top, p.bottom], startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [p.glow, p.glow.opacity(0)], center: .topTrailing, startRadius: 0, endRadius: 220)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 7) {
            if m.outOfDate || m.over {
                Circle().strokeBorder(p.faint, lineWidth: 1.5).frame(width: 7, height: 7).frame(width: 13, height: 13)
            } else {
                Lamp(color: p.accent, glow: p.dark)
            }
            Text(ActivityWords.label(m, theme: true)).printed(10.5).foregroundStyle(p.muted).lineLimit(1).fixedSize()
            Spacer(minLength: 4)
            if m.outOfDate {
                Text("Out of date").font(.geist(12, .semibold))
                    .foregroundStyle(p.accent).brightness(p.dark ? 0.12 : -0.22)
                    .padding(.horizontal, 7).frame(height: 20)
                    .background(RoundedRectangle(cornerRadius: 3).fill(p.accent.opacity(p.dark ? 0.16 : 0.12)))
            } else {
                let ctx = m.task == nil ? ActivityWords.tally(m.state) : ActivityWords.context(m.step)
                Text(ctx).printed(10.5).foregroundStyle(p.muted).lineLimit(1)
            }
            if !m.outOfDate && !m.over {
                Button(intent: RefreshNowIntent()) {
                    RefreshMark(size: 13, weight: .semibold)
                        .foregroundStyle(p.muted)
                        .frame(width: 28, height: 28)
                        .background(RoundedRectangle(cornerRadius: 3).fill(raised))
                        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(hair2, lineWidth: 1))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh")
                .padding(.vertical, -12)
                .padding(.trailing, -8)
            }
        }
        .frame(height: 20)
    }

    @ViewBuilder private func taskRows(_ task: LiveNowState.Task) -> some View {
        Group {
            if let title = task.title {
                Text(title)
                    .font(.geist(20, task.isEvent ? .medium : .semibold)).tracking(-0.45)
                    .foregroundStyle(p.ink)
                    .lineLimit(2).minimumScaleFactor(0.8)
                    .privacySensitive()
            } else {
                Hidden(width: 176, height: 15, color: redact).frame(height: 24)
            }
        }
        .padding(.top, 8)
        HStack(spacing: 6) {
            GoalDot(color: Color(hex: task.color), ring: p.muted)
            if m.state.hidden {
                Hidden(width: 104, height: 10, color: redact)
            } else {
                Text(ActivityWords.goal(task)).foregroundStyle(p.muted).lineLimit(1).privacySensitive()
            }
            if let o = m.step.outcome {
                Steps(done: o.done, total: o.steps, on: p.ink, off: p.ink.opacity(p.dark ? 0.18 : 0.14)).padding(.leading, 2)
            }
            Spacer(minLength: 4)
            right(task)
        }
        .font(.geist(12.5, .medium))
        .foregroundStyle(p.muted)
        .frame(height: 18)
        .padding(.top, 5)
        if let slot = m.slot {
            SlotBar(slot: slot, remaining: remaining(slot), fill: m.step.kind == .busy ? p.faint : p.accent, track: p.track, height: 4, live: m.live)
                .padding(.top, 10)
        }
        Spacer(minLength: 0)
        bottom
    }

    /// Beside the goal: the countdown, or how long it takes, or where things stood.
    @ViewBuilder private func right(_ task: LiveNowState.Task) -> some View {
        if m.outOfDate {
            Text(ActivityWords.context(m.step)).lineLimit(1)
        } else if let slot = m.slot {
            HStack(spacing: 4) {
                LeftClock(slot: slot, live: m.live, at: m.date)
                    .font(.geistMono(15, .semibold)).tracking(-0.3).monospacedDigit()
                    .foregroundStyle(p.ink)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text("left")
            }
            .fixedSize()
        } else {
            HStack(spacing: 6) {
                if m.step.kind == .free && ActivityWords.urgent(task) {
                    Text("Urgent").font(.geist(11.5, .semibold))
                        .foregroundStyle(p.accent).brightness(p.dark ? 0.12 : -0.22)
                        .padding(.horizontal, 6).frame(height: 18)
                        .background(RoundedRectangle(cornerRadius: 3).fill(p.accent.opacity(p.dark ? 0.16 : 0.12)))
                }
                Text(WidgetText.duration(task.minutes)).lineLimit(1)
            }
            .fixedSize()
        }
    }

    @ViewBuilder private var bottom: some View {
        if m.outOfDate {
            HStack(spacing: 10) {
                Text(ActivityWords.turnedLine(m)).font(.geist(12.5)).foregroundStyle(p.muted).lineLimit(1).privacySensitive()
                Spacer(minLength: 4)
                Button(intent: RefreshNowIntent()) {
                    HStack(spacing: 6) {
                        RefreshMark(size: 11)
                        Text("Refresh").font(.geist(13, .medium))
                    }
                    .foregroundStyle(raised)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(RoundedRectangle(cornerRadius: 3).fill(p.ink))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .frame(height: 28)
        } else if let next = m.step.next {
            NextLine(next: next, hidden: m.state.hidden, ink: p.ink, muted: p.muted, size: 12.5, label: 10.5).frame(height: 16)
        } else {
            Text("Nothing else on the calendar today").printed(10.5).foregroundStyle(p.muted).lineLimit(1).frame(height: 16)
        }
    }

    private func remaining(_ slot: ClosedRange<Date>) -> Double {
        let total = slot.upperBound.timeIntervalSince(slot.lowerBound)
        return total > 0 ? min(1, max(0, slot.upperBound.timeIntervalSince(m.date) / total)) : 0
    }
}

// MARK: - The Dynamic Island, always black

/// The island's light: the lamp in the window look, your accent (as at night) in your theme.
private func islandAccent(_ m: NowActivityModel) -> Color {
    m.window ? lampLight : WidgetPalette.of(m.state.look.dark, accent: m.state.look.accentDark).accent
}

private let islandMuted = Color(rgb: 0x9DA4AE)

/// The island's mark: a slot draining round its goal's colour, the lamp in free time, a tick when it's all clear, and
/// Refresh's mark once it's out of date.
struct IslandGlyph: View {
    let m: NowActivityModel
    var size: CGFloat

    var body: some View {
        let acc = islandAccent(m)
        Group {
            if m.outOfDate {
                ZStack {
                    Circle().strokeBorder(Color(rgb: 0x4A515C), lineWidth: max(1.6, size * 0.06))
                    RefreshMark(size: size * 0.44).foregroundStyle(Color(rgb: 0xB4BAC2))
                }
            } else if let slot = m.slot {
                let meeting = m.step.kind == .busy
                SlotRing(slot: slot, color: meeting ? .white.opacity(0.78) : acc, track: meeting ? .white.opacity(0.18) : acc.opacity(0.26),
                         dot: meeting ? nil : Color(hex: m.task?.color), size: size, live: m.live, at: m.date)
            } else if m.task != nil {
                ZStack {
                    Circle().fill(acc.opacity(0.24)).frame(width: size * 0.66, height: size * 0.66)
                    Circle().fill(acc).frame(width: size * 0.34, height: size * 0.34).shadow(color: acc, radius: size * 0.2)
                }
            } else if !m.over {
                Image(systemName: "checkmark").font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(acc)
            }
        }
        .frame(width: size, height: size)
    }
}

/// The compact island's right side: the time left, when free time ends, or how long since it went out of date.
struct IslandTrailing: View {
    let m: NowActivityModel
    var size: CGFloat = 14.5

    var body: some View {
        Group {
            if m.outOfDate {
                SinceClock(since: m.state.turn, live: m.live, at: m.date).foregroundStyle(islandMuted)
            } else if let slot = m.slot {
                LeftClock(slot: slot, live: m.live, at: m.date).foregroundStyle(m.step.kind == .busy ? .white : islandAccent(m))
            } else if m.step.kind == .free, let until = m.step.until {
                Text(NowWords.clock(until)).foregroundStyle(.white)
            } else if let task = m.task {
                Text(WidgetText.compactDuration(task.minutes)).foregroundStyle(islandMuted)
            }
        }
        .font(.geistMono(size, .semibold)).tracking(-0.4)
        .monospacedDigit()
        .lineLimit(1).minimumScaleFactor(0.5)
    }
}

/// The expanded island's top left: the mark, what this is, and how long.
struct IslandExpandedLeading: View {
    let m: NowActivityModel

    private var sub: String {
        if m.outOfDate { return "As of \(NowWords.clock(m.state.asOf))" }
        if m.task == nil { return ActivityWords.tally(m.state) }
        if m.step.kind == .busy, let until = m.step.until { return "Until \(NowWords.clock(until))" }
        return ActivityWords.context(m.step)
    }

    var body: some View {
        HStack(spacing: 10) {
            IslandGlyph(m: m, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(ActivityWords.label(m, theme: false)).printed(10.5).foregroundStyle(.white.opacity(0.66))
                Text(sub).font(.geist(13, .medium)).foregroundStyle(.white.opacity(0.94))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .padding(.leading, 4)
    }
}

/// The expanded island's top right: the big clock.
struct IslandExpandedTrailing: View {
    let m: NowActivityModel

    var body: some View {
        IslandTrailing(m: m, size: 27)
            .tracking(-0.8)
            .frame(height: 34)
            .padding(.trailing, 4)
    }
}

/// The expanded island's body: the task, its goal, and what's next, with Refresh. On a ticket in the window look.
struct IslandExpandedBottom: View {
    let m: NowActivityModel

    var body: some View {
        if let task = m.task {
            if m.window { windowTicket(task) } else { themeRows(task) }
        } else {
            HStack(spacing: 8) {
                Text(m.over ? "It starts again when you open the planner." : "Dump the next thing into the app.")
                    .font(.geist(13)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                Spacer(minLength: 4)
                if !m.over { roundRefresh(fill: .white.opacity(0.15), ink: .white) }
            }
            .frame(height: 30)
        }
    }

    private var probably: String { "Probably now, from \(NowWords.clock(m.state.turn))" }
    private var white64: Color { .white.opacity(0.64) }

    private func themeRows(_ task: LiveNowState.Task) -> some View {
        let acc = islandAccent(m)
        return VStack(alignment: .leading, spacing: 0) {
            if m.outOfDate {
                Text(probably).printed(10.5).foregroundStyle(.white.opacity(0.66)).padding(.bottom, 2)
            }
            if let title = task.title {
                Text(title).font(.geist(18, task.isEvent ? .medium : .semibold)).tracking(-0.4).foregroundStyle(.white)
                    .lineLimit(1).privacySensitive()
            } else {
                Hidden(width: 170, height: 14, color: .white.opacity(0.16)).frame(height: 22)
            }
            HStack(spacing: 6) {
                GoalDot(color: Color(hex: task.color), ring: white64)
                if m.state.hidden {
                    Hidden(width: 96, height: 9, color: .white.opacity(0.14))
                } else {
                    Text(ActivityWords.goal(task)).lineLimit(1).privacySensitive()
                }
                if let o = m.step.outcome { Steps(done: o.done, total: o.steps, on: .white, off: .white.opacity(0.22)).padding(.leading, 2) }
                Spacer(minLength: 4)
                Text(m.outOfDate ? ActivityWords.context(m.step) : ActivityWords.meta(task))
                    .foregroundStyle(ActivityWords.urgent(task) && !m.outOfDate ? acc : white64)
                    .lineLimit(1)
            }
            .font(.geist(12.5, .medium))
            .foregroundStyle(white64)
            .frame(height: 18)
            .padding(.top, 4)
            HStack(spacing: 8) {
                if m.outOfDate {
                    Text(ActivityWords.turnedLine(m)).font(.geist(13)).foregroundStyle(white64).lineLimit(1).privacySensitive()
                    Spacer(minLength: 4)
                    Button(intent: RefreshNowIntent()) {
                        HStack(spacing: 6) {
                            RefreshMark(size: 11)
                            Text("Refresh").font(.geist(13, .semibold))
                        }
                        .foregroundStyle(.black)
                        .padding(.horizontal, 13).frame(height: 30)
                        .background(Capsule().fill(.white))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                } else {
                    if let next = m.step.next {
                        NextLine(next: next, hidden: m.state.hidden, ink: .white, muted: white64, size: 12.5, label: 10.5)
                    } else {
                        Text("Nothing else on the calendar today").font(.geist(13)).foregroundStyle(white64).lineLimit(1)
                        Spacer(minLength: 4)
                    }
                    roundRefresh(fill: .white.opacity(0.15), ink: .white)
                }
            }
            .frame(height: 30)
            .padding(.top, 8)
        }
        .padding(.horizontal, 4)
    }

    private func windowTicket(_ task: LiveNowState.Task) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title = task.title {
                Text(title).font(.geist(17, task.isEvent ? .medium : .semibold)).tracking(-0.4).foregroundStyle(Paper.ink)
                    .lineLimit(1).privacySensitive()
            } else {
                Hidden(width: 150, height: 13, color: Paper.ink.opacity(0.14)).frame(height: 20)
            }
            HStack(spacing: 6) {
                GoalDot(color: Color(hex: task.color), ring: Paper.muted)
                if m.state.hidden {
                    Hidden(width: 96, height: 9, color: Paper.ink.opacity(0.12))
                } else {
                    Text(ActivityWords.goal(task)).font(.geist(12, .medium)).foregroundStyle(Paper.muted).lineLimit(1).privacySensitive()
                }
                if let o = m.step.outcome { Steps(done: o.done, total: o.steps, on: Paper.ink, off: Paper.track).padding(.leading, 2) }
                Spacer(minLength: 4)
                Text(m.outOfDate ? ActivityWords.context(m.step) : ActivityWords.meta(task)).printed(10)
                    .foregroundStyle(ActivityWords.urgent(task) && !m.outOfDate ? Paper.red : Paper.muted)
                    .lineLimit(1)
            }
            .frame(height: 14)
            .padding(.top, 5)
            Spacer(minLength: 6)
            Perforation().padding(.horizontal, -14)
            HStack(spacing: 8) {
                if m.outOfDate {
                    Button(intent: RefreshNowIntent()) {
                        HStack(spacing: 6) {
                            RefreshMark(size: 10)
                            Text("Refresh").printed(10.5)
                        }
                        .foregroundStyle(Paper.red)
                        .padding(.leading, 8).padding(.trailing, 9).frame(height: 24)
                        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Paper.red, lineWidth: 1.5))
                        .frame(height: 34)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 4)
                    Text(probably).printed(10).foregroundStyle(Paper.muted).lineLimit(1).minimumScaleFactor(0.8)
                } else {
                    if let next = m.step.next {
                        NextLine(next: next, hidden: m.state.hidden, ink: Paper.ink, muted: Paper.muted, size: 12, label: 10)
                    } else {
                        Text("Nothing after this").printed(10).foregroundStyle(Paper.muted)
                        Spacer(minLength: 4)
                    }
                    roundRefresh(fill: .clear, ink: Paper.ink, ring: Paper.ink.opacity(0.4), size: 28)
                }
            }
            .frame(height: 34)
        }
        .padding(.horizontal, 14).padding(.top, 9)
        .frame(height: 93)
        .background {
            GeometryReader { g in
                TicketShape(notch: g.size.height - 35.75, radius: 6, corner: 12).fill(Paper.paper)
            }
        }
    }

    private func roundRefresh(fill: Color, ink: Color, ring: Color = .clear, size: CGFloat = 32) -> some View {
        Button(intent: RefreshNowIntent()) {
            RefreshMark(size: size * 0.44, weight: .semibold)
                .foregroundStyle(ink)
                .frame(width: size, height: size)
                .background(Circle().fill(fill))
                .overlay(Circle().strokeBorder(ring, lineWidth: 1.5))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Refresh")
        .padding(.vertical, -7)
        .padding(.trailing, -7)
    }
}

/// The island's light, for its keyline.
func nowActivityKeyline(_ m: NowActivityModel) -> Color { islandAccent(m) }
