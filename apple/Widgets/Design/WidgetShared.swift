import Foundation
import LifeIsShortCore

/// What the app and its widgets share: where today's picture is kept, and the widgets' names.
enum WidgetShared {
    /// The Home Screen widget and the lock screen's.
    static let nowKind = "LifeIsShortNow"
    static let lockKind = "LifeIsShortLock"

    /// The App Group both the app and its widgets can reach: LISAppGroup in each one's Info.plist, from LIS_BUNDLE_ID.
    /// Nil in a build that isn't signed with it (the CI's Simulator builds): the widgets then ask you to open the app.
    static var store: WidgetStore? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "LISAppGroup") as? String, !group.isEmpty,
              let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return WidgetStore(directory: directory)
    }

    /// The planner's ask for Claude, to plan today (components/Today.tsx → PLAN_ASK and PLAN_URL).
    static let planAsk = "Plan my day in Life is short: look at my goals, my calendar and my backlog, agree with me which goals today is for and what each one produces by tonight, then save it with plan_today."
    static let planURL: URL = {
        let q = planAsk.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return URL(string: "https://claude.ai/new?q=\(q)") ?? URL(string: "https://claude.ai/new")!
    }()
}

/// The showcase's day (docs/media, scripts/showcase): for the widget gallery's preview before the app has said
/// anything, the system's placeholder, and the app's pictures of the widgets for CI.
enum WidgetSamples {
    static func snapshot(on day: Date, calendar: Calendar = .current, look: WidgetSnapshot.Look = .standard) -> WidgetSnapshot {
        func at(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        }
        let ship = "#3E63DD", podcast = "#D6409F", run = "#12A594"
        return WidgetSnapshot(
            at: at(9, 5), day: WidgetTimeline.dayString(day, calendar: calendar), look: look, hours: .init(start: 9, end: 21),
            items: [
                .init(id: "t1", title: "Fix the onboarding crash", start: at(10, 30), minutes: 60, priority: 1, goal: "Ship v2 of the app", color: ship),
                .init(id: "t2", title: "Book 3 guests", start: at(12), minutes: 30, goal: "Launch the podcast", color: podcast),
                .init(id: "t3", title: "Record episode 1", start: at(14, 30), minutes: 90, goal: "Launch the podcast", color: podcast),
                .init(id: "e1", title: "Design review", start: at(16, 30), minutes: 45, event: true),
                .init(id: "t4", title: "Training run", start: at(18, 30), minutes: 45, goal: "Run a half marathon", color: run),
                .init(id: "t5", title: "Cut a 60-second trailer", minutes: 45, priority: 1, goal: "Launch the podcast", color: podcast),
                .init(id: "t6", title: "Write the v2 release notes", minutes: 60, goal: "Ship v2 of the app", color: ship),
                .init(id: "t7", title: "Call the plumber", minutes: 30, priority: 3),
            ],
            today: .init(done: 2, total: 7),
            outcomes: [
                .init(goal: "Ship v2 of the app", color: ship, text: "Onboarding crash fixed and the build in for review", done: 0, steps: 2),
                .init(goal: "Launch the podcast", color: podcast, text: "Guests booked and episode 1 recorded", done: 1, steps: 2),
            ])
    }

    /// The sample day at a time on it.
    static func moment(_ hour: Int, _ minute: Int = 0, on day: Date = Date(), calendar: Calendar = .current,
                       look: WidgetSnapshot.Look = .standard, planned: Bool = true) -> WidgetMoment {
        var s = snapshot(on: day, calendar: calendar, look: look)
        if !planned { s.outcomes = nil }
        let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        return WidgetTimeline.moment(at: date, snapshot: s, calendar: calendar)
    }
}
