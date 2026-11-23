import Foundation

/// Today's picture, as the planner hands it to the app for the widgets (lib/widget.ts → widgetSnapshot): what's on the
/// calendar from a missed slot's grace to the end of tomorrow, the top of the backlog in the order Now picks from, today's
/// outcomes and counts, and how the planner looks. The widgets work out Now and Next from it as the day goes on
/// (WidgetTimeline). Read from the bridge with the same limits the planner keeps to; stored as JSON in the App Group.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public static let version = 1
    /// Limits, as lib/widget.ts keeps them, with a little room.
    static let maxItems = 40
    static let maxOutcomes = 5
    static let maxText = 160
    /// The largest message the bridge takes for it.
    static let maxBytes = 64 * 1024

    public enum Theme: String, Codable, Sendable, CaseIterable {
        case tide, day, night
    }

    public struct Look: Codable, Hashable, Sendable {
        public var light: Theme
        public var dark: Theme
        /// #RRGGBB.
        public var accentLight: String
        public var accentDark: String

        public init(light: Theme, dark: Theme, accentLight: String, accentDark: String) {
            self.light = light
            self.dark = dark
            self.accentLight = accentLight
            self.accentDark = accentDark
        }

        public static let standard = Look(light: .tide, dark: .night, accentLight: "#0A7DB2", accentDark: "#F2A541")
    }

    public struct Hours: Codable, Equatable, Sendable {
        public var start: Int
        public var end: Int

        public init(start: Int, end: Int) {
            self.start = start
            self.end = end
        }
    }

    public struct Item: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        /// On the calendar from then; nil for the backlog.
        public var start: Date?
        public var minutes: Int
        /// 1 urgent, 2 important, 3 later.
        public var priority: Int
        /// YYYY-MM-DD.
        public var due: String?
        /// The goal it moves.
        public var goal: String?
        /// Its section's colour, #RRGGBB.
        public var color: String?
        /// A Google Calendar event: busy time, not a task.
        public var event: Bool?
        /// Held up by a step before it on its goal's chart.
        public var blocked: Bool?

        public init(id: String, title: String, start: Date? = nil, minutes: Int, priority: Int = 2, due: String? = nil,
                    goal: String? = nil, color: String? = nil, event: Bool? = nil, blocked: Bool? = nil) {
            self.id = id
            self.title = title
            self.start = start
            self.minutes = minutes
            self.priority = priority
            self.due = due
            self.goal = goal
            self.color = color
            self.event = event
            self.blocked = blocked
        }

        public var isEvent: Bool { event == true }
        public var end: Date? { start.map { $0.addingTimeInterval(TimeInterval(minutes) * 60) } }
        /// When a missed slot goes back to the backlog: an hour after it ends (lib/select.ts → BACKLOG_GRACE).
        public var backAt: Date? { end.map { $0.addingTimeInterval(60 * 60) } }
    }

    public struct Outcome: Codable, Equatable, Sendable {
        public var goal: String
        public var color: String?
        /// What's true by tonight.
        public var text: String
        public var done: Int
        public var steps: Int

        public init(goal: String, color: String? = nil, text: String, done: Int, steps: Int) {
            self.goal = goal
            self.color = color
            self.text = text
            self.done = done
            self.steps = steps
        }
    }

    public struct Count: Codable, Hashable, Sendable {
        public var done: Int
        public var total: Int

        public init(done: Int, total: Int) {
            self.done = done
            self.total = total
        }
    }

    public var v: Int
    /// When it was made.
    public var at: Date
    /// The day it was made on, YYYY-MM-DD where the planner is: today's plan and counts belong to it.
    public var day: String
    public var look: Look
    public var hours: Hours
    /// On the calendar by start, then the backlog in the order Now picks from.
    public var items: [Item]
    public var today: Count
    /// Today's outcomes once it's planned; nil while it isn't.
    public var outcomes: [Outcome]?

    public init(at: Date, day: String, look: Look = .standard, hours: Hours = Hours(start: 9, end: 21), items: [Item],
                today: Count, outcomes: [Outcome]?) {
        v = Self.version
        self.at = at
        self.day = day
        self.look = look
        self.hours = hours
        self.items = items
        self.today = today
        self.outcomes = outcomes
    }

    // MARK: - Reading it

    /// How it's stored, and how the bridge's message is read: dates as epoch milliseconds, as the planner sends them.
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        e.outputFormatting = [.sortedKeys]
        return e
    }

    /// The planner's message, checked: nil when it's malformed, too big or from another version. Anything out of range
    /// is dropped or trimmed rather than trusted: titles, colours, counts, how many there are.
    public static func parse(_ body: Any) -> WidgetSnapshot? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body), data.count <= maxBytes,
              let raw = try? decoder().decode(WidgetSnapshot.self, from: data), raw.v == version else { return nil }
        return raw.cleaned()
    }

    public static func decode(_ data: Data) -> WidgetSnapshot? {
        guard data.count <= maxBytes * 2, let s = try? decoder().decode(WidgetSnapshot.self, from: data), s.v == version else { return nil }
        return s
    }

    public func encoded() -> Data? {
        try? Self.encoder().encode(self)
    }

    func cleaned() -> WidgetSnapshot {
        var s = self
        s.day = Self.isDay(day) ? day : ""
        s.look.accentLight = Self.hex(look.accentLight) ?? Look.standard.accentLight
        s.look.accentDark = Self.hex(look.accentDark) ?? Look.standard.accentDark
        let start = min(max(hours.start, 0), 23), end = min(max(hours.end, 1), 24)
        s.hours = end > start ? Hours(start: start, end: end) : Hours(start: 9, end: 21)
        s.items = items.prefix(Self.maxItems).compactMap { $0.cleaned() }
        s.today = Count(done: min(max(today.done, 0), 9999), total: min(max(today.total, 0), 9999))
        s.outcomes = outcomes.map { list in list.prefix(Self.maxOutcomes).compactMap { $0.cleaned() } }
        return s
    }

    static func text(_ s: String?, max: Int = maxText) -> String? {
        guard let s else { return nil }
        let words = s.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        return words.isEmpty ? nil : String(words.prefix(max))
    }

    static func hex(_ s: String?) -> String? {
        guard let s, s.count == 7, s.first == "#", s.dropFirst().allSatisfy(\.isHexDigit) else { return nil }
        return s.uppercased()
    }

    static func isDay(_ s: String) -> Bool {
        let parts = s.split(separator: "-")
        return s.count == 10 && parts.count == 3 && parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }
}

extension WidgetSnapshot.Item {
    func cleaned() -> WidgetSnapshot.Item? {
        guard DeepLink.isTaskId(id), let title = WidgetSnapshot.text(title) else { return nil }
        var item = self
        item.title = title
        item.minutes = min(max(minutes, 5), 24 * 60)
        item.priority = min(max(priority, 1), 3)
        item.due = due.flatMap { WidgetSnapshot.isDay($0) ? $0 : nil }
        item.goal = WidgetSnapshot.text(goal, max: 100)
        item.color = WidgetSnapshot.hex(color)
        item.event = event == true ? true : nil
        item.blocked = blocked == true ? true : nil
        return item
    }
}

extension WidgetSnapshot.Outcome {
    func cleaned() -> WidgetSnapshot.Outcome? {
        guard let goal = WidgetSnapshot.text(goal, max: 100), let text = WidgetSnapshot.text(text) else { return nil }
        let steps = min(max(steps, 0), 99)
        return .init(goal: goal, color: WidgetSnapshot.hex(color), text: text, done: min(max(done, 0), steps), steps: steps)
    }
}

/// Where the snapshot is kept for the widgets: a file in a folder both the app and its widgets can reach (the App
/// Group's container), written only when it changes.
public struct WidgetStore {
    public static let fileName = "widget.json"
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    private var file: URL { directory.appendingPathComponent(Self.fileName) }

    public func load() -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return WidgetSnapshot.decode(data)
    }

    /// As `load`, but telling "nothing kept" (nil: signed out, or never heard) from "can't read it now", which throws:
    /// a phone that restarted and hasn't been unlocked yet keeps the file locked.
    public func read() throws -> WidgetSnapshot? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return WidgetSnapshot.decode(try Data(contentsOf: file))
    }

    /// Keeps it, or with nil forgets it. True when that changed what's kept, so the widgets need to hear about it.
    /// Two snapshots that differ only in when they were made count as a change once the older is half an hour old,
    /// so the widgets learn the planner's been open.
    @discardableResult
    public func save(_ snapshot: WidgetSnapshot?) throws -> Bool {
        let old = load()
        guard let snapshot else {
            guard FileManager.default.fileExists(atPath: file.path) else { return false }
            try FileManager.default.removeItem(at: file)
            return true
        }
        if let old {
            var same = old
            same.at = snapshot.at
            if same == snapshot, snapshot.at.timeIntervalSince(old.at) < 30 * 60 { return false }
        }
        guard let data = snapshot.encoded() else { return false }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
        return true
    }
}
