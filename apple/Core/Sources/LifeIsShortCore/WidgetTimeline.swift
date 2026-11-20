import Foundation

/// The view out of the widget's window at a time of day: the planner's own scenes (public/scenes), dawn and dusk in
/// amber, the meadow by day, balloons on a weekend, and night.
public enum WidgetScene: String, CaseIterable, Sendable {
    case meadow, amber, night, balloon

    /// The hours the view changes at: amber from five, the day from seven, amber again from five in the evening, night
    /// from eight.
    static let changes = [5, 7, 17, 20]

    public static func at(_ date: Date, calendar: Calendar = .current) -> WidgetScene {
        let hour = calendar.component(.hour, from: date)
        if hour < 5 || hour >= 20 { return .night }
        if hour < 7 || hour >= 17 { return .amber }
        return calendar.isDateInWeekend(date) ? .balloon : .meadow
    }
}

/// What a widget shows at one moment: the one thing to do now, what comes next, and the rest of today. Worked out from
/// the planner's snapshot by the planner's own rules (lib/select.ts → focus), so it stays right as the day goes on.
public struct WidgetMoment: Equatable, Sendable {
    public typealias Item = WidgetSnapshot.Item

    /// The line beside Now: how long you have (components/Next.tsx says the same).
    public enum Context: Equatable, Sendable {
        /// Now is on the calendar: it runs until then.
        case until(Date)
        /// In a meeting until then.
        case busyUntil(Date)
        /// Free until the next thing on the calendar today.
        case freeUntil(Date)
        /// Nothing else on the calendar, and the day's still on.
        case restOfDay
        case none
    }

    public let date: Date
    /// Nil before the planner has ever handed anything over (open the app), or when it's signed out.
    public let snapshot: WidgetSnapshot?
    public let now: Item?
    /// Now is on the calendar over this moment.
    public let live: Bool
    public let context: Context
    public let next: Item?
    /// What's on the calendar for the rest of today after Now, events too, soonest first.
    public let later: [Item]
    /// Today's outcomes, while the snapshot is today's and today's planned. Nil when it isn't planned (or not known).
    public let outcomes: [WidgetSnapshot.Outcome]?
    /// Today's tasks, done and in all, while the snapshot is today's.
    public let today: WidgetSnapshot.Count?
    public let scene: WidgetScene
    /// The planner hasn't been opened since before yesterday: the widget says so.
    public let stale: Bool

    public init(date: Date, snapshot: WidgetSnapshot?, now: Item?, live: Bool, context: Context, next: Item?, later: [Item],
                outcomes: [WidgetSnapshot.Outcome]?, today: WidgetSnapshot.Count?, scene: WidgetScene, stale: Bool) {
        self.date = date
        self.snapshot = snapshot
        self.now = now
        self.live = live
        self.context = context
        self.next = next
        self.later = later
        self.outcomes = outcomes
        self.today = today
        self.scene = scene
        self.stale = stale
    }

    /// Now's slot, while it's on the calendar over this moment.
    public var slot: ClosedRange<Date>? {
        guard live, let start = now?.start, let end = now?.end, end > start else { return nil }
        return start...end
    }

    /// How much of Now's slot is still to come, 1 to 0; nil when it isn't on the calendar.
    public var remaining: Double? {
        guard let slot else { return nil }
        let total = slot.upperBound.timeIntervalSince(slot.lowerBound)
        return min(1, max(0, slot.upperBound.timeIntervalSince(date) / total))
    }

    /// Nothing to do at all: the planner's open and the list is empty.
    public var allClear: Bool { snapshot != nil && now == nil }
}

public enum WidgetTimeline {
    /// How many of the rest of today's things a widget can list.
    public static let laterCount = 4

    public static func moment(at date: Date, snapshot: WidgetSnapshot?, calendar: Calendar = .current) -> WidgetMoment {
        let scene = WidgetScene.at(date, calendar: calendar)
        guard let snapshot else {
            return WidgetMoment(date: date, snapshot: nil, now: nil, live: false, context: .none, next: nil, later: [],
                                outcomes: nil, today: nil, scene: scene, stale: false)
        }
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date)) ?? date.addingTimeInterval(86400)
        let timed = snapshot.items.filter { $0.start != nil }.sorted { ($0.start!, $0.minutes) < ($1.start!, $1.minutes) }
        let tasks = timed.filter { !$0.isEvent }
        let live = tasks.first { $0.start! <= date && $0.end! > date }

        // The backlog: the planner's order, with missed slots back on top of their priority once their hour's up.
        var backlog = snapshot.items.filter { $0.start == nil && !$0.isEvent }
        let returned = tasks.filter { $0.backAt! <= date }.sorted { $0.end! > $1.end! }
        for var missed in returned.reversed() {
            missed.start = nil
            let at = backlog.firstIndex { $0.priority >= missed.priority } ?? backlog.endIndex
            backlog.insert(missed, at: at)
        }

        let now = live ?? backlog.first
        let next = tasks.first { $0.start! > date && $0.start! < dayEnd && $0.id != now?.id }
            ?? backlog.first { $0.id != now?.id }
        let busy = timed.first { $0.isEvent && $0.start! <= date && $0.end! > date }
        let upcoming = timed.filter { $0.start! > date && $0.start! < dayEnd && $0.id != now?.id }
        let freeUntil = now != nil && live == nil ? upcoming.first?.start : nil

        let context: WidgetMoment.Context
        if let live, let end = live.end { context = .until(end) }
        else if let end = busy?.end { context = .busyUntil(end) }
        else if let freeUntil { context = .freeUntil(freeUntil) }
        else {
            let hour = calendar.component(.hour, from: date)
            context = now != nil && hour >= snapshot.hours.start && hour < snapshot.hours.end ? .restOfDay : .none
        }

        let sameDay = snapshot.day == dayString(date, calendar: calendar)
        let stale = date.timeIntervalSince(snapshot.at) > 36 * 3600
        return WidgetMoment(date: date, snapshot: snapshot, now: now, live: live != nil, context: context, next: next,
                            later: Array(upcoming.prefix(laterCount)), outcomes: sameDay ? snapshot.outcomes : nil,
                            today: sameDay ? snapshot.today : nil, scene: scene, stale: stale)
    }

    /// The moments after `from`, up to `until`, at which what a widget shows changes: slots starting and ending, missed
    /// ones going back to the backlog, the view changing, the day's hours, midnight. The widget's timeline has an entry
    /// at each.
    public static func changes(after from: Date, until: Date, snapshot: WidgetSnapshot?, calendar: Calendar = .current) -> [Date] {
        var dates = Set<Date>()
        for item in snapshot?.items ?? [] {
            for d in [item.start, item.end, item.isEvent ? nil : item.backAt] { if let d { dates.insert(d) } }
        }
        var day = calendar.startOfDay(for: from)
        let hours = Set(WidgetScene.changes + [0] + (snapshot.map { [$0.hours.start, $0.hours.end % 24] } ?? []))
        while day <= until {
            for h in hours { if let d = calendar.date(bySettingHour: h, minute: 0, second: 0, of: day) { dates.insert(d) } }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        // The staleness note, a day and a half after the planner was last open.
        if let at = snapshot?.at { dates.insert(at.addingTimeInterval(36 * 3600)) }
        return dates.filter { $0 > from && $0 <= until }.sorted()
    }

    /// YYYY-MM-DD in the calendar's time zone, as the planner writes days.
    public static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// Words the widgets share with the planner (lib/format.ts).
public enum WidgetText {
    /// "30 min", "1 h", "1.5 h", "1 h 15 min", as lib/format.ts → fmtDur.
    public static func duration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        if minutes % 60 == 0 { return "\(minutes / 60) h" }
        if minutes % 30 == 0 { return "\(Double(minutes) / 60) h" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    /// The short form, for a departure board: "30m", "1h", "1h30".
    public static func compactDuration(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        return minutes % 60 == 0 ? "\(minutes / 60)h" : "\(minutes / 60)h\(String(format: "%02d", minutes % 60))"
    }

    public static func priority(_ p: Int) -> String {
        switch p {
        case 1: return "Urgent"
        case 3: return "Later"
        default: return "Important"
        }
    }
}
