import Foundation

// The "Now" Live Activity on the Lock Screen and in the Dynamic Island (docs/apple.md → Live Activity): what it shows,
// worked out from the planner's snapshot by the widgets' own rules (WidgetTimeline), and when the app starts, updates,
// swaps or ends it (LiveNowPolicy). Foundation only, like the rest of the core; the ActivityKit side is
// Widgets/Live/NowActivity.swift.
//
// A Live Activity has no timeline: its words change only when the app updates it (there's no push, the app is signed
// without one). So every update carries two steps: `now`, and `then`, what Now becomes at `turn`, the first moment that
// changes what it shows. The activity's stale date is `turn`, so iOS redraws it with `then` there with no code running.
// Countdowns and bars run by themselves within a step.

/// The Live Activity's look, picked in the planner's settings, as the widget's Edit Widget menu offers it.
public enum LiveNowStyle: String, Codable, Sendable, CaseIterable {
    /// The view out of the train window for the time of day, with the task on a ticket.
    case window
    /// The planner's own theme: Tide, Day train or Night train.
    case theme
}

/// What the activity shows: its ActivityKit content state.
public struct LiveNowState: Codable, Hashable, Sendable {
    public static let version = 1
    /// ActivityKit refuses more than 4 KB for an activity's data. The state keeps well under it (`LiveNow.fit`).
    public static let maxBytes = 3_300

    public var v: Int
    /// When the planner last spoke: the snapshot's `at` ("As of 10:48").
    public var asOf: Date
    /// When this was worked out.
    public var made: Date
    /// YYYY-MM-DD, where the planner is.
    public var day: String
    public var style: LiveNowStyle
    public var look: WidgetSnapshot.Look
    /// Task names left out (Settings → Hide task names on the Lock Screen): the views draw bars in their place.
    public var hidden: Bool
    /// Today's tasks, done and in all, while the snapshot is today's.
    public var today: WidgetSnapshot.Count?
    /// What it shows until `turn`.
    public var now: Step
    /// What it shows from `turn`, once iOS has marked it stale.
    public var then: Step
    /// The first moment that changes what it shows: the activity's stale date.
    public var turn: Date
    /// What happens at `turn`.
    public var why: Turn
    /// When the day's hours end (Settings → Calendar → Your day).
    public var dayEnd: Date

    /// One moment's picture.
    public struct Step: Codable, Hashable, Sendable {
        public enum Kind: String, Codable, Sendable {
            /// A task on the calendar over this moment.
            case slot
            /// The top of the backlog, free until the next thing on the calendar.
            case free
            /// In a meeting (a Google Calendar event); `task` is the meeting, `next` what Now is after it.
            case busy
            /// The top of the backlog, with nothing else on the calendar today.
            case rest
            /// Nothing to do.
            case clear
            /// The day's hours are over.
            case over
        }

        public var kind: Kind
        public var task: Task?
        /// A slot or meeting: when it ends. Free time: when the next thing starts.
        public var until: Date?
        /// What comes after: the next thing on the calendar today, else the next on the backlog.
        public var next: Entry?
        /// Today's steps for the task's goal, when today is planned.
        public var outcome: Progress?
        /// The view out of the window at this moment (WidgetScene).
        public var scene: String

        public init(kind: Kind, task: Task? = nil, until: Date? = nil, next: Entry? = nil, outcome: Progress? = nil, scene: String) {
            self.kind = kind
            self.task = task
            self.until = until
            self.next = next
            self.outcome = outcome
            self.scene = scene
        }

        /// A slot or meeting running over this moment: its start and end, for the countdown and the bar.
        public var slot: ClosedRange<Date>? {
            guard kind == .slot || kind == .busy, let start = task?.start, let until, until > start else { return nil }
            return start...until
        }
    }

    public struct Task: Codable, Hashable, Sendable {
        public var id: String
        /// Nil when task names are hidden.
        public var title: String?
        public var goal: String?
        /// The section's colour, #RRGGBB.
        public var color: String?
        /// 1 urgent, 2 important, 3 later.
        public var priority: Int
        /// On the calendar from then; nil for the backlog.
        public var start: Date?
        public var minutes: Int
        /// A Google Calendar event.
        public var event: Bool?

        public init(id: String, title: String?, goal: String? = nil, color: String? = nil, priority: Int = 2, start: Date? = nil,
                    minutes: Int, event: Bool? = nil) {
            self.id = id
            self.title = title
            self.goal = goal
            self.color = color
            self.priority = priority
            self.start = start
            self.minutes = minutes
            self.event = event
        }

        public var isEvent: Bool { event == true }
    }

    public struct Entry: Codable, Hashable, Sendable {
        public var title: String?
        /// Nil for the backlog ("Then").
        public var start: Date?
        public var minutes: Int
        public var color: String?

        public init(title: String?, start: Date? = nil, minutes: Int, color: String? = nil) {
            self.title = title
            self.start = start
            self.minutes = minutes
            self.color = color
        }
    }

    public struct Progress: Codable, Hashable, Sendable {
        public var done: Int
        public var steps: Int

        public init(done: Int, steps: Int) {
            self.done = done
            self.steps = steps
        }
    }

    public enum Turn: String, Codable, Sendable {
        /// Now's slot ends.
        case slotEnded
        /// The meeting ends.
        case meetingEnded
        /// The next slot starts.
        case slotStarts
        /// Something else: a missed slot goes back to the backlog, the view changes.
        case changed
        /// The day's hours end.
        case dayEnd
    }

    /// What the views draw: `then` once iOS has marked the activity stale at `turn`.
    public func showing(isStale: Bool) -> Step { isStale ? then : now }

    /// The same picture, whenever it was worked out: an update that changes nothing is skipped.
    public func sameAs(_ other: LiveNowState) -> Bool {
        var a = self
        a.made = other.made
        return a == other
    }
}

public enum LiveNow {
    /// The longest title, goal and next title kept, in UTF-8 bytes: ample for two lines on the Lock Screen, and with
    /// both steps full of four-byte characters the state stays about 1.6 KB.
    static let titleBytes = 120
    static let goalBytes = 60
    static let nextBytes = 80

    /// What the activity shows at `date`. Nil before the planner has said anything, or once it's signed out.
    public static func state(at date: Date, snapshot: WidgetSnapshot?, style: LiveNowStyle = .window, hidden: Bool = false,
                             calendar: Calendar = .current) -> LiveNowState? {
        guard let snapshot else { return nil }
        let dayEnd = Self.dayEnd(of: date, hours: snapshot.hours, calendar: calendar)
        let now: LiveNowState.Step
        let then: LiveNowState.Step
        let turn: Date
        let why: LiveNowState.Turn
        if date >= dayEnd {
            now = over(at: date, calendar: calendar)
            then = now
            turn = date.addingTimeInterval(12 * 3600)
            why = .dayEnd
        } else {
            now = step(at: date, snapshot: snapshot, hidden: hidden, calendar: calendar)
            let next = nextTurn(after: date, from: now, snapshot: snapshot, style: style, hidden: hidden, until: dayEnd, calendar: calendar)
            then = next.step
            turn = next.at
            why = next.why
        }
        let sameDay = snapshot.day == WidgetTimeline.dayString(date, calendar: calendar)
        let state = LiveNowState(v: LiveNowState.version, asOf: snapshot.at, made: date, day: snapshot.day, style: style,
                                 look: snapshot.look, hidden: hidden, today: sameDay ? snapshot.today : nil, now: now, then: then,
                                 turn: turn, why: why, dayEnd: dayEnd)
        return fit(state)
    }

    /// The last word, when the day's hours are over: "That's the day."
    public static func over(state: LiveNowState?, at date: Date, style: LiveNowStyle = .window, calendar: Calendar = .current) -> LiveNowState {
        let step = over(at: date, calendar: calendar)
        return LiveNowState(v: LiveNowState.version, asOf: state?.asOf ?? date, made: date, day: state?.day ?? WidgetTimeline.dayString(date, calendar: calendar),
                            style: state?.style ?? style, look: state?.look ?? .standard, hidden: state?.hidden ?? false,
                            today: state?.today, now: step, then: step, turn: date.addingTimeInterval(12 * 3600), why: .dayEnd,
                            dayEnd: state?.dayEnd ?? date)
    }

    /// When the day's hours end on the day of `date`, in the calendar's time zone.
    public static func dayEnd(of date: Date, hours: WidgetSnapshot.Hours, calendar: Calendar = .current) -> Date {
        let start = calendar.startOfDay(for: date)
        if hours.end >= 24 { return calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86400) }
        return calendar.date(bySettingHour: hours.end, minute: 0, second: 0, of: start) ?? start.addingTimeInterval(Double(hours.end) * 3600)
    }

    /// When the day's hours start on the day of `date`.
    public static func dayStart(of date: Date, hours: WidgetSnapshot.Hours, calendar: Calendar = .current) -> Date {
        let start = calendar.startOfDay(for: date)
        return calendar.date(bySettingHour: hours.start, minute: 0, second: 0, of: start) ?? start.addingTimeInterval(Double(hours.start) * 3600)
    }

    // MARK: - One moment

    static func step(at date: Date, snapshot: WidgetSnapshot, hidden: Bool, calendar: Calendar) -> LiveNowState.Step {
        let m = WidgetTimeline.moment(at: date, snapshot: snapshot, calendar: calendar)
        let scene = m.scene.rawValue
        guard let now = m.now else { return .init(kind: .clear, scene: scene) }
        let outcome = m.outcomes?.first { $0.goal == now.goal && $0.steps > 0 }.map { LiveNowState.Progress(done: $0.done, steps: $0.steps) }
        switch m.context {
        case .until(let end):
            return .init(kind: .slot, task: task(now, hidden: hidden), until: end, next: m.next.map { entry($0, hidden: hidden) },
                         outcome: outcome, scene: scene)
        case .busyUntil(let end):
            // In a meeting: the meeting itself, and after it, what the planner says is Now.
            let meeting = snapshot.items
                .filter { $0.isEvent && $0.start != nil }
                .sorted { ($0.start!, $0.minutes) < ($1.start!, $1.minutes) }
                .first { $0.start! <= date && $0.end! > date }
            guard let meeting else {
                return .init(kind: .free, task: task(now, hidden: hidden), until: end, next: m.next.map { entry($0, hidden: hidden) },
                             outcome: outcome, scene: scene)
            }
            var after = entry(now, hidden: hidden)
            after.start = nil
            return .init(kind: .busy, task: task(meeting, hidden: hidden), until: end, next: after, scene: scene)
        case .freeUntil(let start):
            return .init(kind: .free, task: task(now, hidden: hidden), until: start, next: m.next.map { entry($0, hidden: hidden) },
                         outcome: outcome, scene: scene)
        case .restOfDay, .none:
            return .init(kind: .rest, task: task(now, hidden: hidden), next: m.next.map { entry($0, hidden: hidden) },
                         outcome: outcome, scene: scene)
        }
    }

    static func over(at date: Date, calendar: Calendar) -> LiveNowState.Step {
        .init(kind: .over, scene: WidgetScene.at(date, calendar: calendar).rawValue)
    }

    /// The first change after `date` that alters what the activity shows, and what it shows then. A change of view
    /// counts only in the window look, which draws it.
    static func nextTurn(after date: Date, from now: LiveNowState.Step, snapshot: WidgetSnapshot, style: LiveNowStyle, hidden: Bool,
                         until dayEnd: Date, calendar: Calendar) -> (at: Date, why: LiveNowState.Turn, step: LiveNowState.Step) {
        let dates = WidgetTimeline.changes(after: date, until: dayEnd, snapshot: snapshot, calendar: calendar).filter { $0 < dayEnd }
        for d in dates {
            let s = step(at: d, snapshot: snapshot, hidden: hidden, calendar: calendar)
            if differs(s, now, style: style) { return (d, why(now, at: d), s) }
        }
        return (dayEnd, .dayEnd, over(at: dayEnd, calendar: calendar))
    }

    static func differs(_ a: LiveNowState.Step, _ b: LiveNowState.Step, style: LiveNowStyle) -> Bool {
        guard style == .theme else { return a != b }
        var a = a, b = b
        a.scene = ""
        b.scene = ""
        return a != b
    }

    static func why(_ now: LiveNowState.Step, at date: Date) -> LiveNowState.Turn {
        guard now.until == date else { return .changed }
        switch now.kind {
        case .slot: return .slotEnded
        case .busy: return .meetingEnded
        case .free: return .slotStarts
        default: return .changed
        }
    }

    static func task(_ item: WidgetSnapshot.Item, hidden: Bool) -> LiveNowState.Task {
        .init(id: item.id, title: hidden ? nil : cap(item.title, bytes: titleBytes), goal: hidden ? nil : cap(item.goal, bytes: goalBytes),
              color: item.color, priority: item.priority, start: item.start, minutes: item.minutes, event: item.event)
    }

    static func entry(_ item: WidgetSnapshot.Item, hidden: Bool) -> LiveNowState.Entry {
        .init(title: hidden ? nil : cap(item.title, bytes: nextBytes), start: item.start, minutes: item.minutes, color: item.color)
    }

    // MARK: - Size

    /// At most `bytes` of UTF-8, cut between characters, never inside one.
    static func cap(_ s: String?, bytes: Int) -> String? {
        guard let s else { return nil }
        guard s.utf8.count > bytes else { return s }
        var out = ""
        var used = 0
        for ch in s {
            let n = String(ch).utf8.count
            if used + n > bytes { break }
            out.append(ch)
            used += n
        }
        return out.isEmpty ? nil : out
    }

    /// The state's size as ActivityKit will carry it, near enough: its JSON.
    public static func size(_ state: LiveNowState) -> Int {
        (try? JSONEncoder().encode(state).count) ?? Int.max
    }

    /// Under the limit, trimming in a fixed order while it's over: titles shorter, then no titles for what's next, then
    /// no goals.
    public static func fit(_ state: LiveNowState, maxBytes: Int = LiveNowState.maxBytes) -> LiveNowState {
        var s = state
        guard size(s) > maxBytes else { return s }
        let shorter = { (step: inout LiveNowState.Step) in
            let title = cap(step.task?.title, bytes: 60)
            step.task?.title = title
        }
        shorter(&s.now)
        shorter(&s.then)
        guard size(s) > maxBytes else { return s }
        s.now.next?.title = nil
        s.then.next?.title = nil
        guard size(s) > maxBytes else { return s }
        s.now.task?.goal = nil
        s.then.task?.goal = nil
        return s
    }
}

// MARK: - When to start, update, swap and end it

/// What the app does with the activity, each time something might have changed it. Pure, so it's tested here; the app's
/// NowActivityController carries it out with ActivityKit.
public enum LiveNowPolicy {
    /// A Live Activity lives eight hours at most, then iOS ends it.
    public static let life: TimeInterval = 8 * 3600
    /// Opening the planner swaps in a fresh one once the running one is this old and wouldn't last the day.
    public static let rotateInApp: TimeInterval = 3 * 3600
    /// Refresh swaps in a fresh one when the running one has less than this left.
    public static let rotateOnRefresh: TimeInterval = 1 * 3600
    /// The day's last word stays up this long after the day's hours end.
    public static let lastWord: TimeInterval = 30 * 60

    public enum Trigger: String, Sendable {
        /// The planner handed over today's snapshot.
        case snapshot
        /// The app came to the front, or left it.
        case foreground, leaving
        /// Midnight, or the clock or time zone changed.
        case timeChange
        /// A turn came round while the app was in front.
        case tick
        /// The setting changed.
        case setting
        /// Refresh on the activity.
        case refresh
        /// Show Now: a Shortcut, Siri, the control or the planner's button. Overrides a swipe-away and the day's hours,
        /// and always puts up a fresh one.
        case show
    }

    /// The snapshot, as the app could read it.
    public enum Reading: Equatable, Sendable {
        case snapshot(WidgetSnapshot)
        /// Signed out, or another server: nothing to show.
        case signedOut
        /// Not readable yet: the phone restarted and hasn't been unlocked. Leave things as they are.
        case unreadable
    }

    /// The activity that's running, as the app recorded it.
    public struct Running: Equatable, Sendable {
        public var started: Date
        public var state: LiveNowState?

        public init(started: Date, state: LiveNowState?) {
            self.started = started
            self.state = state
        }
    }

    public struct Input {
        public var trigger: Trigger
        public var date: Date
        /// Settings → Now on the Lock Screen.
        public var on: Bool
        /// Live Activities are allowed for the app (Settings → Life is short → Live Activities).
        public var allowed: Bool
        /// The app is in front.
        public var active: Bool
        public var reading: Reading
        public var running: Running?
        /// The day (YYYY-MM-DD) the person swiped it away, if they did.
        public var dismissed: String?
        public var style: LiveNowStyle
        public var hidden: Bool
        /// The running one was put up with Show Now: it stays outside the day's hours until iOS ends it.
        public var pinned: Bool
        public var calendar: Calendar

        public init(trigger: Trigger, date: Date, on: Bool, allowed: Bool, active: Bool, reading: Reading, running: Running?,
                    dismissed: String? = nil, style: LiveNowStyle = .window, hidden: Bool = false, pinned: Bool = false,
                    calendar: Calendar = .current) {
            self.trigger = trigger
            self.date = date
            self.on = on
            self.allowed = allowed
            self.active = active
            self.reading = reading
            self.running = running
            self.dismissed = dismissed
            self.style = style
            self.hidden = hidden
            self.pinned = pinned
            self.calendar = calendar
        }
    }

    public enum Action: Equatable, Sendable {
        case nothing
        case start(LiveNowState)
        case update(LiveNowState)
        /// A fresh one in place of the running one, before it runs out of life.
        case rotate(LiveNowState)
        /// End it, showing `last` until `dismissAt`, or gone at once when that's nil.
        case end(last: LiveNowState?, dismissAt: Date?)
    }

    public static func decide(_ i: Input) -> Action {
        let snapshot: WidgetSnapshot
        switch i.reading {
        case .unreadable: return .nothing
        case .signedOut: return i.running == nil ? .nothing : .end(last: nil, dismissAt: nil)
        case .snapshot(let s): snapshot = s
        }
        guard i.on, i.allowed else { return i.running == nil ? .nothing : .end(last: nil, dismissAt: nil) }

        let start = LiveNow.dayStart(of: i.date, hours: snapshot.hours, calendar: i.calendar)
        let end = LiveNow.dayEnd(of: i.date, hours: snapshot.hours, calendar: i.calendar)
        let explicit = i.trigger == .show
        let byHand = explicit || (i.pinned && i.running != nil)
        guard byHand || (i.date >= start && i.date < end) else {
            guard let running = i.running else { return .nothing }
            // Past the day's hours: a last word, gone half an hour after the day ends. Before them: gone.
            guard i.date >= end else { return .end(last: nil, dismissAt: nil) }
            let until = end.addingTimeInterval(lastWord)
            return .end(last: LiveNow.over(state: running.state, at: i.date, style: i.style, calendar: i.calendar),
                        dismissAt: until > i.date ? until : nil)
        }
        guard let state = LiveNow.state(at: i.date, snapshot: snapshot, style: i.style, hidden: i.hidden, calendar: i.calendar) else { return .nothing }
        let today = WidgetTimeline.dayString(i.date, calendar: i.calendar)
        let fresh = i.active && (i.trigger == .snapshot || i.trigger == .setting)

        guard let running = i.running else {
            // Started from the planner on screen with a fresh snapshot, or by asking for it. iOS allows nothing else.
            guard fresh || i.trigger == .refresh || explicit else { return .nothing }
            if i.dismissed == today && !explicit { return .nothing }
            // Never yesterday's day popping up: an old snapshot waits for the planner.
            if !explicit, snapshot.day != today, i.date.timeIntervalSince(snapshot.at) > 12 * 3600 { return .nothing }
            return .start(state)
        }

        let age = i.date.timeIntervalSince(running.started)
        let rotate: Bool
        if explicit {
            // Asked for: a fresh one, its eight hours from now, and never one iOS left drawn blank.
            rotate = true
        } else if fresh {
            rotate = age >= rotateInApp && running.started.addingTimeInterval(life) < end
        } else if i.trigger == .refresh {
            rotate = age >= life - rotateOnRefresh
        } else {
            rotate = false
        }
        if rotate { return .rotate(state) }
        if let shown = running.state, shown.sameAs(state) { return .nothing }
        return .update(state)
    }

    /// Our activity has gone and the app didn't end it: the person swiped it away, unless it had used up its hours.
    public static func swipedAway(started: Date, now: Date) -> Bool {
        now.timeIntervalSince(started) < life - 60
    }
}
