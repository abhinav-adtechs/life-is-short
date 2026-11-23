import XCTest
@testable import LifeIsShortCore

/// The widgets' side of the planner's snapshot (lib/widget.ts): reading it from the bridge, keeping it, and working out
/// what to show as the day goes on.
final class WidgetTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/London")!
        return c
    }()

    /// Friday 20 November 2026, at a time.
    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 20) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    private func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

    /// The message as the planner sends it: lib/widget.test.ts's day.
    private func message() -> [String: Any] {
        [
            "v": 1, "at": ms(at(10, 50)), "day": "2026-11-20",
            "look": ["light": "day", "dark": "night", "accentLight": "#d98a1c", "accentDark": "#F2A541"],
            "hours": ["start": 9, "end": 21],
            "items": [
                ["id": "t1", "title": "Reply to Sam", "start": ms(at(9, 30)), "minutes": 30, "priority": 2],
                ["id": "t2", "title": "Fix the onboarding crash", "start": ms(at(10, 30)), "minutes": 60, "priority": 1, "goal": "Ship v2 of the app", "color": "#3E63DD"],
                ["id": "t3", "title": "Book 3 guests", "start": ms(at(12)), "minutes": 30, "priority": 2, "goal": "Launch the podcast", "color": "#D6409F"],
                ["id": "e1", "title": "Design review", "start": ms(at(15)), "minutes": 60, "priority": 2, "event": true],
                ["id": "t4", "title": "Record episode 1", "start": ms(at(14, 30, day: 21)), "minutes": 90, "priority": 2],
                ["id": "t5", "title": "Cut a trailer", "minutes": 45, "priority": 1, "goal": "Launch the podcast"],
                ["id": "t6", "title": "Call the plumber", "minutes": 30, "priority": 3],
                ["id": "t7", "title": "Submit the feed", "minutes": 30, "priority": 1, "blocked": true],
            ],
            "today": ["done": 2, "total": 7],
            "outcomes": [["goal": "Ship v2 of the app", "color": "#3E63DD", "text": "Onboarding crash fixed and the build in for review", "done": 0, "steps": 2]],
        ]
    }

    private func snapshot() -> WidgetSnapshot { WidgetSnapshot.parse(message())! }
    private func moment(_ date: Date, _ s: WidgetSnapshot? = nil) -> WidgetMoment {
        WidgetTimeline.moment(at: date, snapshot: s ?? snapshot(), calendar: calendar)
    }

    // MARK: - Reading it

    func testReadsThePlannersMessage() {
        let s = snapshot()
        XCTAssertEqual(s.at, at(10, 50))
        XCTAssertEqual(s.look, .init(light: .day, dark: .night, accentLight: "#D98A1C", accentDark: "#F2A541"))
        XCTAssertEqual(s.items.count, 8)
        XCTAssertEqual(s.items[1], .init(id: "t2", title: "Fix the onboarding crash", start: at(10, 30), minutes: 60, priority: 1,
                                         goal: "Ship v2 of the app", color: "#3E63DD"))
        XCTAssertEqual(s.items[3].event, true)
        XCTAssertEqual(s.items[7].blocked, true)
        XCTAssertNil(s.items[5].start)
        XCTAssertEqual(s.outcomes?.first?.steps, 2)
        XCTAssertEqual(BridgeRequest.parse(["type": "widget", "snapshot": message()]), .widget(s))
    }

    func testAnEmptyMessageEmptiesTheWidgets() {
        XCTAssertEqual(BridgeRequest.parse(["type": "widget"]), .widget(nil))
        XCTAssertEqual(BridgeRequest.parse(["type": "widget", "snapshot": NSNull()]), .widget(nil))
        XCTAssertEqual(BridgeRequest.widget(nil).allowed, [.planner])
    }

    func testRefusesWhatIsntASnapshot() {
        XCTAssertNil(BridgeRequest.parse(["type": "widget", "snapshot": "today"]))
        XCTAssertNil(BridgeRequest.parse(["type": "widget", "snapshot": ["v": 1]]))
        var future = message()
        future["v"] = 2
        XCTAssertNil(WidgetSnapshot.parse(future))
        var huge = message()
        huge["items"] = (0..<2000).map { ["id": "t\($0)", "title": String(repeating: "x", count: 100), "minutes": 30, "priority": 2] }
        XCTAssertNil(WidgetSnapshot.parse(huge), "too big for the bridge")
    }

    func testTrimsWhatsOutOfRange() {
        var m = message()
        m["items"] = [
            ["id": "../x", "title": "Bad id", "minutes": 30, "priority": 2],
            ["id": "t1", "title": "   ", "minutes": 30, "priority": 2],
            ["id": "t2", "title": "  Too\n  many   spaces ", "minutes": 100000, "priority": 9, "color": "red", "due": "soon", "event": false],
        ] + (0..<50).map { ["id": "b\($0)", "title": "Task \($0)", "minutes": 30, "priority": 2] }
        m["outcomes"] = [["goal": "G", "text": "T", "done": 9, "steps": 3], ["goal": " ", "text": "No goal", "done": 0, "steps": 0]]
        m["hours"] = ["start": 22, "end": 20]
        m["look"] = ["light": "tide", "dark": "night", "accentLight": "blue", "accentDark": "#12345"]
        let s = WidgetSnapshot.parse(m)!
        XCTAssertEqual(s.items.first, .init(id: "t2", title: "Too many spaces", minutes: 24 * 60, priority: 3))
        XCTAssertEqual(s.items.count, WidgetSnapshot.maxItems - 2)
        XCTAssertEqual(s.outcomes, [.init(goal: "G", text: "T", done: 3, steps: 3)])
        XCTAssertEqual(s.hours, .init(start: 9, end: 21))
        XCTAssertEqual(s.look, .standard)
        XCTAssertNil(WidgetSnapshot.parse(["v": 1, "at": "noon", "day": "x", "look": [:], "hours": [:], "items": [], "today": [:]]))
    }

    func testKeepsItOnlyWhenItChanges() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("widget-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = WidgetStore(directory: dir)
        XCTAssertNil(store.load())
        var s = snapshot()
        XCTAssertTrue(try store.save(s))
        XCTAssertEqual(store.load(), s)
        s.at = s.at.addingTimeInterval(60)
        XCTAssertFalse(try store.save(s), "the same day, a minute later")
        s.at = s.at.addingTimeInterval(45 * 60)
        XCTAssertTrue(try store.save(s), "the same day, but the planner's been open since")
        s.items.removeFirst()
        XCTAssertTrue(try store.save(s))
        XCTAssertEqual(try store.read(), s)
        XCTAssertTrue(try store.save(nil))
        XCTAssertNil(store.load())
        XCTAssertNil(try store.read(), "nothing kept isn't an error")
        XCTAssertFalse(try store.save(nil))
    }

    // MARK: - What it shows

    func testNowIsTheSlotOverTheCurrentTime() {
        let m = moment(at(10, 50))
        XCTAssertEqual(m.now?.id, "t2")
        XCTAssertTrue(m.live)
        XCTAssertEqual(m.context, .until(at(11, 30)))
        XCTAssertEqual(m.slot, at(10, 30)...at(11, 30))
        XCTAssertEqual(m.remaining!, 40.0 / 60, accuracy: 0.001)
        XCTAssertEqual(m.next?.id, "t3")
        XCTAssertEqual(m.later.map(\.id), ["t3", "e1"])
        XCTAssertEqual(m.today, .init(done: 2, total: 7))
        XCTAssertEqual(m.outcomes?.count, 1)
        XCTAssertEqual(m.scene, .meadow)
        XCTAssertFalse(m.stale)
        XCTAssertFalse(m.allClear)
    }

    func testBetweenSlotsNowIsTheTopOfTheBacklog() {
        let m = moment(at(11, 40))
        XCTAssertEqual(m.now?.id, "t5", "the blocked task waits behind the ones you can start")
        XCTAssertFalse(m.live)
        XCTAssertNil(m.slot)
        XCTAssertEqual(m.context, .freeUntil(at(12)))
        XCTAssertEqual(m.next?.id, "t3")
    }

    func testInAMeetingYoureBusy() {
        let m = moment(at(15, 20))
        XCTAssertEqual(m.context, .busyUntil(at(16)))
        XCTAssertFalse(m.live)
        XCTAssertEqual(m.next?.id, "t5", "nothing else on the calendar today: the next in the backlog")
    }

    func testAMissedSlotGoesBackToTheBacklogAfterItsHour() {
        let s = snapshot()
        let rest = WidgetSnapshot(at: s.at, day: s.day, items: s.items.filter { $0.priority != 1 }, today: s.today, outcomes: nil)
        XCTAssertEqual(moment(at(10, 20), rest).now?.id, "t6", "missed at ten, but its hour isn't up")
        XCTAssertEqual(moment(at(11, 5), rest).now?.id, "t1", "back on top of the backlog's Important and Later tasks")
        XCTAssertEqual(moment(at(12, 25)).now?.id, "t3", "Book 3 guests is on now")
        XCTAssertEqual(moment(at(12, 35)).now?.id, "t2", "an urgent slot missed comes back ahead of the other urgent tasks")
        XCTAssertEqual(moment(at(12, 35)).next?.id, "t5")
    }

    func testTheRestOfTheDayAndTheEvening() {
        let evening = moment(at(18))
        XCTAssertEqual(evening.context, .restOfDay)
        XCTAssertEqual(evening.later, [])
        XCTAssertEqual(evening.scene, .amber)
        let late = moment(at(22))
        XCTAssertEqual(late.context, .none)
        XCTAssertEqual(late.scene, .night)
    }

    func testTomorrowForgetsTodaysPlan() {
        let m = moment(at(9, 0, day: 21))
        XCTAssertNil(m.outcomes)
        XCTAssertNil(m.today)
        XCTAssertEqual(m.scene, .balloon, "Saturday")
        XCTAssertEqual(m.context, .freeUntil(at(14, 30, day: 21)))
        XCTAssertTrue(moment(at(9, 0, day: 23)).stale)
    }

    func testBeforeThePlannerHasSaidAnythingAndWhenTheresNothingToDo() {
        let none = WidgetTimeline.moment(at: at(12), snapshot: nil, calendar: calendar)
        XCTAssertNil(none.now)
        XCTAssertFalse(none.allClear)
        let empty = WidgetSnapshot(at: at(12), day: "2026-11-20", items: [], today: .init(done: 3, total: 3), outcomes: nil)
        let clear = moment(at(12, 30), empty)
        XCTAssertTrue(clear.allClear)
        XCTAssertEqual(clear.context, .none)
    }

    func testTheTimelineChangesWhenSomethingDoes() {
        let changes = WidgetTimeline.changes(after: at(10, 50), until: at(18), snapshot: snapshot(), calendar: calendar)
        XCTAssertEqual(changes, [at(11), at(11, 30), at(12), at(12, 30), at(13, 30), at(15), at(16), at(17)])
        XCTAssertTrue(WidgetTimeline.changes(after: at(10, 50), until: at(10, 50), snapshot: nil, calendar: calendar).isEmpty)
    }

    func testTheView() {
        XCTAssertEqual(WidgetScene.at(at(4, 59), calendar: calendar), .night)
        XCTAssertEqual(WidgetScene.at(at(5), calendar: calendar), .amber)
        XCTAssertEqual(WidgetScene.at(at(7), calendar: calendar), .meadow)
        XCTAssertEqual(WidgetScene.at(at(12, 0, day: 22), calendar: calendar), .balloon)
        XCTAssertEqual(WidgetScene.at(at(17), calendar: calendar), .amber)
        XCTAssertEqual(WidgetScene.at(at(20), calendar: calendar), .night)
    }

    func testWords() {
        XCTAssertEqual(WidgetText.duration(30), "30 min")
        XCTAssertEqual(WidgetText.duration(60), "1 h")
        XCTAssertEqual(WidgetText.duration(90), "1.5 h")
        XCTAssertEqual(WidgetText.duration(75), "1 h 15 min")
        XCTAssertEqual(WidgetText.compactDuration(45), "45m")
        XCTAssertEqual(WidgetText.compactDuration(120), "2h")
        XCTAssertEqual(WidgetText.compactDuration(90), "1h30")
    }

    func testTaskLinks() {
        XCTAssertEqual(DeepLink.command(from: URL(string: "lifeisshort://task/t1kz9x2")!), .task(id: "t1kz9x2"))
        XCTAssertEqual(DeepLink.command(from: URL(string: "lifeisshort://task/r8f2k.2026-11-20")!), .task(id: "r8f2k.2026-11-20"))
        XCTAssertNil(DeepLink.command(from: URL(string: "lifeisshort://task")!))
        XCTAssertNil(DeepLink.command(from: URL(string: "lifeisshort://task/a/b")!))
        XCTAssertEqual(DeepLink.taskURL("t1")?.absoluteString, "lifeisshort://task/t1")
        XCTAssertNil(DeepLink.taskURL("a b"))
        XCTAssertEqual(NativeCommand.task(id: "t1").payload, ["name": "task", "id": "t1"])
    }
}
