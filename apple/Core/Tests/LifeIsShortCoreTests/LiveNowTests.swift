import XCTest
@testable import LifeIsShortCore

/// The Lock Screen's Now (the Live Activity): what it shows and when it turns, its size, and when the app starts,
/// updates, swaps and ends it. The day is WidgetTests' (lib/widget.test.ts's), Friday 20 November 2026 in London.
final class LiveNowTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/London")!
        return c
    }()

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 20) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    private func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

    private func message(items: [[String: Any]]? = nil) -> [String: Any] {
        [
            "v": 1, "at": ms(at(10, 48)), "day": "2026-11-20",
            "look": ["light": "tide", "dark": "night", "accentLight": "#0A7DB2", "accentDark": "#F2A541"],
            "hours": ["start": 9, "end": 21],
            "items": items ?? [
                ["id": "t1", "title": "Reply to Sam", "start": ms(at(9, 30)), "minutes": 30, "priority": 2],
                ["id": "t2", "title": "Fix the onboarding crash", "start": ms(at(10, 30)), "minutes": 60, "priority": 1, "goal": "Ship v2 of the app", "color": "#3E63DD"],
                ["id": "t3", "title": "Book 3 guests", "start": ms(at(12)), "minutes": 30, "priority": 2, "goal": "Launch the podcast", "color": "#D6409F"],
                ["id": "e1", "title": "Design review", "start": ms(at(15)), "minutes": 60, "priority": 2, "event": true],
                ["id": "t4", "title": "Record episode 1", "start": ms(at(14, 30, day: 21)), "minutes": 90, "priority": 2],
                ["id": "t5", "title": "Cut a trailer", "minutes": 45, "priority": 1, "goal": "Launch the podcast", "color": "#D6409F"],
                ["id": "t6", "title": "Call the plumber", "minutes": 30, "priority": 3],
            ],
            "today": ["done": 2, "total": 7],
            "outcomes": [["goal": "Ship v2 of the app", "color": "#3E63DD", "text": "Onboarding crash fixed and the build in for review", "done": 0, "steps": 2]],
        ]
    }

    private func snapshot(_ m: [String: Any]? = nil) -> WidgetSnapshot { WidgetSnapshot.parse(m ?? message())! }

    private func state(_ date: Date, style: LiveNowStyle = .window, hidden: Bool = false, _ s: WidgetSnapshot? = nil) -> LiveNowState {
        LiveNow.state(at: date, snapshot: s ?? snapshot(), style: style, hidden: hidden, calendar: calendar)!
    }

    // MARK: - What it shows

    func testOnASlot() {
        let s = state(at(10, 50))
        XCTAssertEqual(s.now.kind, .slot)
        XCTAssertEqual(s.now.task?.id, "t2")
        XCTAssertEqual(s.now.task?.priority, 1)
        XCTAssertEqual(s.now.until, at(11, 30))
        XCTAssertEqual(s.now.slot, at(10, 30)...at(11, 30))
        XCTAssertEqual(s.now.next, .init(title: "Book 3 guests", start: at(12), minutes: 30, color: "#D6409F"))
        XCTAssertEqual(s.now.outcome, .init(done: 0, steps: 2))
        XCTAssertEqual(s.now.scene, "meadow")
        XCTAssertEqual(s.asOf, at(10, 48))
        XCTAssertEqual(s.today, .init(done: 2, total: 7))
        XCTAssertEqual(s.dayEnd, at(21))
    }

    func testItTurnsWhenTheSlotEndsNotBefore() {
        // At 11:00 Reply to Sam goes back to the backlog, but that changes nothing on show: the turn is 11:30.
        let s = state(at(10, 50))
        XCTAssertEqual(s.turn, at(11, 30))
        XCTAssertEqual(s.why, .slotEnded)
        XCTAssertEqual(s.then.kind, .free)
        XCTAssertEqual(s.then.task?.id, "t5", "the top of the backlog")
        XCTAssertEqual(s.then.until, at(12))
        XCTAssertEqual(s.then.next?.start, at(12))
        XCTAssertEqual(s.showing(isStale: false), s.now)
        XCTAssertEqual(s.showing(isStale: true), s.then)
    }

    func testFreeUntilTheNextSlot() {
        let s = state(at(11, 40))
        XCTAssertEqual(s.now.kind, .free)
        XCTAssertEqual(s.now.until, at(12))
        XCTAssertNil(s.now.slot, "free time runs no countdown")
        XCTAssertEqual(s.turn, at(12))
        XCTAssertEqual(s.why, .slotStarts)
        XCTAssertEqual(s.then.kind, .slot)
        XCTAssertEqual(s.then.task?.id, "t3")
    }

    func testInAMeeting() {
        let date = at(15, 20)
        let s = state(date)
        let planner = WidgetTimeline.moment(at: date, snapshot: snapshot(), calendar: calendar)
        XCTAssertEqual(s.now.kind, .busy)
        XCTAssertEqual(s.now.task?.id, "e1")
        XCTAssertEqual(s.now.task?.isEvent, true)
        XCTAssertEqual(s.now.slot, at(15)...at(16))
        XCTAssertEqual(s.now.next?.title, planner.now?.title, "after the meeting: what the planner says is Now")
        XCTAssertNil(s.now.next?.start)
        XCTAssertEqual(s.turn, at(16))
        XCTAssertEqual(s.why, .meetingEnded)
    }

    func testTheRestOfTheDay() {
        let window = state(at(19))
        XCTAssertEqual(window.now.kind, .rest)
        XCTAssertEqual(window.turn, at(20), "the view out of the window turns to night")
        XCTAssertEqual(window.why, .changed)
        XCTAssertEqual(window.then.scene, "night")
        let theme = state(at(19), style: .theme)
        XCTAssertEqual(theme.turn, at(21), "your theme doesn't draw the view")
        XCTAssertEqual(theme.why, .dayEnd)
        XCTAssertEqual(theme.then.kind, .over)
    }

    func testAllClear() {
        let s = state(at(13), snapshot(message(items: [])))
        XCTAssertEqual(s.now.kind, .clear)
        XCTAssertNil(s.now.task)
        XCTAssertEqual(s.today?.total, 7)
    }

    func testAfterTheDaysHours() {
        let s = state(at(21, 30))
        XCTAssertEqual(s.now.kind, .over)
        XCTAssertEqual(s.then.kind, .over)
        XCTAssertGreaterThan(s.turn, at(21, 30))
        let last = LiveNow.over(state: state(at(20)), at: at(21, 5), calendar: calendar)
        XCTAssertEqual(last.now.kind, .over)
        XCTAssertEqual(last.today, .init(done: 2, total: 7))
    }

    func testTomorrowForgetsTodaysCounts() {
        var m = message()
        m["day"] = "2026-11-19"
        let s = state(at(10, 50), snapshot(m))
        XCTAssertNil(s.today)
        XCTAssertNil(s.now.outcome)
    }

    func testNothingBeforeThePlannerHasSpoken() {
        XCTAssertNil(LiveNow.state(at: at(10), snapshot: nil, calendar: calendar))
    }

    func testLosAngeles() {
        var la = Calendar(identifier: .gregorian)
        la.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let date = la.date(from: DateComponents(year: 2026, month: 11, day: 20, hour: 20, minute: 30))!
        let end = LiveNow.dayEnd(of: date, hours: .init(start: 9, end: 21), calendar: la)
        XCTAssertEqual(la.component(.hour, from: end), 21)
        XCTAssertEqual(end.timeIntervalSince(date), 30 * 60)
        XCTAssertEqual(LiveNow.dayEnd(of: date, hours: .init(start: 9, end: 24), calendar: la), la.date(from: DateComponents(year: 2026, month: 11, day: 21))!)
    }

    func testTheClocksGoBack() {
        // Sunday 25 October 2026: London's clocks go back at 2:00, so the day is 25 hours long.
        let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: 25, hour: 12))!
        let end = LiveNow.dayEnd(of: date, hours: .init(start: 9, end: 21), calendar: calendar)
        XCTAssertEqual(calendar.component(.hour, from: end), 21)
        XCTAssertEqual(end.timeIntervalSince(date), 9 * 3600)
    }

    // MARK: - Privacy and size

    func testHiddenNamesAreLeftOut() throws {
        let s = state(at(10, 50), hidden: true)
        XCTAssertTrue(s.hidden)
        XCTAssertNil(s.now.task?.title)
        XCTAssertNil(s.now.task?.goal)
        XCTAssertNil(s.now.next?.title)
        XCTAssertEqual(s.now.task?.color, "#3E63DD", "the goal's colour stays")
        let json = String(data: try JSONEncoder().encode(s), encoding: .utf8)!
        for words in ["onboarding", "Ship v2", "Book 3", "trailer", "Launch"] {
            XCTAssertFalse(json.contains(words), words)
        }
    }

    func testCutsBetweenCharacters() {
        let family = "👨‍👩‍👧‍👦"
        XCTAssertEqual(family.utf8.count, 25)
        XCTAssertEqual(LiveNow.cap("ab" + family, bytes: 26), "ab")
        XCTAssertEqual(LiveNow.cap("ab" + family, bytes: 27), "ab" + family)
        XCTAssertEqual(LiveNow.cap("héllo", bytes: 2), "h")
        XCTAssertNil(LiveNow.cap(family, bytes: 4))
        XCTAssertEqual(LiveNow.cap("short", bytes: 120), "short")
    }

    func testTheLongestDayFitsWithRoomToSpare() {
        // The longest the planner sends: 160 characters, here four bytes each, everywhere.
        let long = String(repeating: "🎙", count: 160)
        let goal = String(repeating: "🏃", count: 100)
        let items: [[String: Any]] = [
            ["id": String(repeating: "x", count: 64), "title": long, "start": ms(at(10, 30)), "minutes": 60, "priority": 1, "goal": goal, "color": "#3E63DD"],
            ["id": String(repeating: "y", count: 64), "title": long, "start": ms(at(12)), "minutes": 30, "priority": 1, "goal": goal, "color": "#D6409F"],
            ["id": String(repeating: "z", count: 64), "title": long, "start": ms(at(13)), "minutes": 30, "priority": 1, "goal": goal, "color": "#D6409F"],
        ]
        var m = message(items: items)
        m["outcomes"] = [["goal": goal, "color": "#3E63DD", "text": long, "done": 1, "steps": 3]]
        let s = state(at(10, 50), snapshot(m))
        XCTAssertNotNil(s.now.task?.title)
        XCTAssertLessThanOrEqual(LiveNow.size(s), 2_400, "\(LiveNow.size(s)) bytes")
        XCTAssertLessThanOrEqual(LiveNow.size(s), LiveNowState.maxBytes)
        XCTAssertLessThanOrEqual(s.now.task!.title!.utf8.count, LiveNow.titleBytes)
    }

    func testTrimsInOrderWhenOverBudget() {
        let s = state(at(10, 50))
        let full = LiveNow.size(s)
        let titles = LiveNow.fit(s, maxBytes: full - 1)
        XCTAssertEqual(titles.now.next?.title, nil, "short titles weren't enough: next titles go")
        XCTAssertNotNil(titles.now.task?.title)
        let tight = LiveNow.fit(s, maxBytes: 100)
        XCTAssertNil(tight.now.task?.goal)
        XCTAssertNil(tight.then.next?.title)
        XCTAssertEqual(tight.now.task?.id, "t2", "the task and its times always stay")
    }

    func testRoundTrips() throws {
        let s = state(at(15, 20))
        let back = try JSONDecoder().decode(LiveNowState.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(back, s)
        var later = s
        later.made = s.made.addingTimeInterval(90)
        XCTAssertTrue(later.sameAs(s))
        later.now.task?.title = "Something else"
        XCTAssertFalse(later.sameAs(s))
    }

    // MARK: - When to start, update, swap and end it

    private func input(_ trigger: LiveNowPolicy.Trigger, _ date: Date, on: Bool = true, allowed: Bool = true, active: Bool = true,
                       reading: LiveNowPolicy.Reading? = nil, running: LiveNowPolicy.Running? = nil, dismissed: String? = nil) -> LiveNowPolicy.Input {
        .init(trigger: trigger, date: date, on: on, allowed: allowed, active: active, reading: reading ?? .snapshot(snapshot()),
              running: running, dismissed: dismissed, calendar: calendar)
    }

    private func decide(_ i: LiveNowPolicy.Input) -> LiveNowPolicy.Action { LiveNowPolicy.decide(i) }

    private func kind(_ a: LiveNowPolicy.Action) -> String {
        switch a {
        case .nothing: return "nothing"
        case .start: return "start"
        case .update: return "update"
        case .rotate: return "rotate"
        case .end(let last, let until): return last == nil ? (until == nil ? "end" : "end-until") : (until == nil ? "end-last" : "end-last-until")
        }
    }

    func testStartsFromThePlannerOnScreen() {
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50)))), "start")
        if case .start(let s) = decide(input(.snapshot, at(10, 50))) { XCTAssertEqual(s, state(at(10, 50))) } else { XCTFail() }
        XCTAssertEqual(kind(decide(input(.setting, at(10, 50)))), "start", "switched on in Settings")
    }

    func testStartsOnlyWhereIOSAllowsIt() {
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), active: false))), "nothing", "the planner sent it while leaving")
        XCTAssertEqual(kind(decide(input(.foreground, at(10, 50)))), "nothing", "waits for the planner's own snapshot")
        XCTAssertEqual(kind(decide(input(.tick, at(10, 50), active: false))), "nothing")
        XCTAssertEqual(kind(decide(input(.refresh, at(10, 50), active: false))), "start", "an intent may start one")
        XCTAssertEqual(kind(decide(input(.show, at(10, 50), active: false))), "start")
    }

    func testRespectsTheSettings() {
        let running = LiveNowPolicy.Running(started: at(9, 30), state: state(at(9, 30)))
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), on: false))), "nothing")
        XCTAssertEqual(kind(decide(input(.setting, at(10, 50), on: false, running: running))), "end")
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), allowed: false, running: running))), "end")
    }

    func testEndsWhenSignedOutButNotWhenUnreadable() {
        let running = LiveNowPolicy.Running(started: at(9, 30), state: state(at(9, 30)))
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), reading: LiveNowPolicy.Reading.signedOut, running: running))), "end")
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), reading: LiveNowPolicy.Reading.signedOut))), "nothing")
        XCTAssertEqual(kind(decide(input(.refresh, at(10, 50), reading: .unreadable, running: running))), "nothing", "restarted, still locked")
    }

    func testUpdatesOnlyWhenSomethingChanged() {
        let shown = state(at(10, 50))
        let running = LiveNowPolicy.Running(started: at(10, 40), state: shown)
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 52), running: running))), "nothing")
        XCTAssertEqual(kind(decide(input(.leaving, at(11, 31), active: false, running: running))), "update")
        XCTAssertEqual(kind(decide(input(.refresh, at(11, 31), active: false, running: running))), "update")
        var m = message()
        m["today"] = ["done": 3, "total": 7]
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 52), reading: .snapshot(snapshot(m)), running: running))), "update")
    }

    func testSwapsInAFreshOneBeforeItRunsOut() {
        let running = LiveNowPolicy.Running(started: at(9), state: state(at(9)))
        XCTAssertEqual(kind(decide(input(.snapshot, at(11, 59), running: running))), "update", "not three hours old yet")
        XCTAssertEqual(kind(decide(input(.snapshot, at(12, 1), running: running))), "rotate", "it would run out at 17:00")
        XCTAssertEqual(kind(decide(input(.snapshot, at(12, 1), active: false, running: running))), "update", "can't start one from the background")
        XCTAssertEqual(kind(decide(input(.refresh, at(15, 59), active: false, running: running))), "update")
        XCTAssertEqual(kind(decide(input(.refresh, at(16, 1), active: false, running: running))), "rotate", "under an hour left")
        let late = LiveNowPolicy.Running(started: at(13, 30), state: state(at(13, 30)))
        XCTAssertEqual(kind(decide(input(.snapshot, at(17), running: late))), "update", "it lasts until the day's end at 21:00")
    }

    func testAfterASwipeNotBackUntilTomorrow() {
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), dismissed: "2026-11-20"))), "nothing")
        XCTAssertEqual(kind(decide(input(.refresh, at(10, 50), active: false, dismissed: "2026-11-20"))), "nothing")
        XCTAssertEqual(kind(decide(input(.show, at(10, 50), dismissed: "2026-11-20"))), "start", "asked for")
        var m = message()
        m["day"] = "2026-11-21"
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50, day: 21), reading: .snapshot(snapshot(m)), dismissed: "2026-11-20"))), "start")
        XCTAssertTrue(LiveNowPolicy.swipedAway(started: at(9), now: at(12)))
        XCTAssertFalse(LiveNowPolicy.swipedAway(started: at(9), now: at(17, 1)), "it ran its eight hours")
    }

    func testOnlyInTheDaysHours() {
        let running = LiveNowPolicy.Running(started: at(13), state: state(at(13)))
        XCTAssertEqual(kind(decide(input(.snapshot, at(8, 30)))), "nothing")
        XCTAssertEqual(kind(decide(input(.snapshot, at(21, 10)))), "nothing")
        XCTAssertEqual(kind(decide(input(.leaving, at(21, 10), active: false, running: running))), "end-last-until")
        if case .end(let last, let until) = decide(input(.leaving, at(21, 10), active: false, running: running)) {
            XCTAssertEqual(last?.now.kind, .over)
            XCTAssertEqual(until, at(21, 30), "a last word for half an hour")
        }
        XCTAssertEqual(kind(decide(input(.foreground, at(22), running: running))), "end-last", "the half hour is over")
        XCTAssertEqual(kind(decide(input(.foreground, at(7, day: 21), running: running))), "end", "yesterday's, in the morning")
    }

    func testNeverYesterdaysDay() {
        var m = message()
        m["day"] = "2026-11-19"
        m["at"] = ms(at(18, day: 19))
        XCTAssertEqual(kind(decide(input(.snapshot, at(10, 50), reading: .snapshot(snapshot(m))))), "nothing")
        XCTAssertEqual(kind(decide(input(.show, at(10, 50), reading: .snapshot(snapshot(m))))), "start")
    }

    // MARK: - The bridge

    func testTheSettingsMessage() {
        XCTAssertEqual(BridgeRequest.parse(["type": "liveActivity"]), .liveActivity(.init()))
        XCTAssertTrue(LiveActivityChange().isQuery)
        XCTAssertEqual(BridgeRequest.parse(["type": "liveActivity", "on": true]), .liveActivity(.init(on: true)))
        XCTAssertEqual(BridgeRequest.parse(["type": "liveActivity", "hideTitles": true, "style": "theme"]),
                       .liveActivity(.init(hideTitles: true, style: .theme)))
        XCTAssertNil(BridgeRequest.parse(["type": "liveActivity", "on": "yes"]))
        XCTAssertNil(BridgeRequest.parse(["type": "liveActivity", "style": "neon"]))
        XCTAssertEqual(BridgeRequest.liveActivity(.init()).allowed, [.planner])
    }
}
