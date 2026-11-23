import ActivityKit
import LifeIsShortCore
import UIKit

/// Starts, updates, swaps and ends the Lock Screen's Now (Widgets/Live/NowActivity.swift) as LiveNowPolicy decides,
/// one request at a time. Everything comes through `sync`: the planner's snapshots (WidgetBridge), the app coming to
/// the front and leaving it, the clock, the planner's settings, and Refresh and Show Now, which iOS runs here in the
/// app even when it isn't open. ActivityKit's calls compile in the widget extension too, but do nothing there.
@MainActor
final class NowActivityController {
    static let shared = NowActivityController()

    /// The person's choices from the planner's settings, and what the app remembers of the activity it started. Kept
    /// in the app's own defaults: the intents run in the app as well.
    enum Saved {
        private static var d: UserDefaults { .standard }
        /// Settings → Now on the Lock Screen. Off until switched on.
        static var on: Bool {
            get { d.bool(forKey: "LISLiveOn") }
            set { d.set(newValue, forKey: "LISLiveOn") }
        }
        /// Settings → Hide task names on the Lock Screen.
        static var hidden: Bool {
            get { d.bool(forKey: "LISLiveHide") }
            set { d.set(newValue, forKey: "LISLiveHide") }
        }
        static var style: LiveNowStyle {
            get { d.string(forKey: "LISLiveStyle").flatMap(LiveNowStyle.init(rawValue:)) ?? .window }
            set { d.set(newValue.rawValue, forKey: "LISLiveStyle") }
        }
        /// The activity the app started, when, and in which build.
        static var id: String? {
            get { d.string(forKey: "LISLiveId") }
            set { d.set(newValue, forKey: "LISLiveId") }
        }
        static var started: Date? {
            get { d.object(forKey: "LISLiveStarted") as? Date }
            set { d.set(newValue, forKey: "LISLiveStarted") }
        }
        static var build: String? {
            get { d.string(forKey: "LISLiveBuild") }
            set { d.set(newValue, forKey: "LISLiveBuild") }
        }
        /// One the app ended itself, so its going isn't taken for a swipe.
        static var ended: String? {
            get { d.string(forKey: "LISLiveEnded") }
            set { d.set(newValue, forKey: "LISLiveEnded") }
        }
        /// The day (YYYY-MM-DD) the person swiped it away: it stays away for the rest of that day.
        static var dismissed: String? {
            get { d.string(forKey: "LISLiveDismissed") }
            set { d.set(newValue, forKey: "LISLiveDismissed") }
        }
    }

    /// This install: the build number, and when the app's binary was made. Builds from Xcode all say build 1, and an
    /// activity left by the install before is drawn blank on the Lock Screen while the Dynamic Island still shows it.
    private static let install: String = {
        let made = Bundle.main.executableURL
            .flatMap { try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate }
        return "\(AppEnvironment.build)-\(Int(made?.timeIntervalSince1970 ?? 0))"
    }()

    /// The planner's Settings offers it here: on an iPhone, and on an iPad that allows Live Activities.
    static var isSupported: Bool {
        UIDevice.current.userInterfaceIdiom == .phone || ActivityAuthorizationInfo().areActivitiesEnabled
    }

    private var tail: Task<Void, Never>?
    /// What the planner said last in this run: nothing yet (read the App Group's copy), a snapshot, or nil inside for
    /// signed out.
    private var lastHeard: WidgetSnapshot??
    private var tick: Task<Void, Never>?
    private var watched = Set<String>()
    private var background = UIBackgroundTaskIdentifier.invalid

    private init() {}

    /// As the app launches, even in the background for an intent: from here on the intents and the clock reach it.
    func launch() {
        NowActivityHub.sync = { trigger in await NowActivityController.shared.sync(trigger) }
        NotificationCenter.default.addObserver(forName: UIApplication.significantTimeChangeNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in await NowActivityController.shared.sync(.timeChange) }
        }
    }

    /// The planner's snapshot from the bridge, or nil: signed out, or another server.
    func heard(_ snapshot: WidgetSnapshot?) {
        lastHeard = .some(snapshot)
        Task { await sync(.snapshot) }
    }

    func foreground() {
        Task { await sync(.foreground) }
    }

    /// Leaving the app: a last update, with the few seconds iOS gives to finish it.
    func leaving() {
        tick?.cancel()
        tick = nil
        if background == .invalid {
            background = UIApplication.shared.beginBackgroundTask(withName: "Now on the Lock Screen") {
                MainActor.assumeIsolated { NowActivityController.shared.finishBackground() }
            }
        }
        Task {
            await sync(.leaving)
            finishBackground()
        }
    }

    private func finishBackground() {
        guard background != .invalid else { return }
        UIApplication.shared.endBackgroundTask(background)
        background = .invalid
    }

    /// The planner's settings: change what it says, then answer how things stand.
    func apply(_ change: LiveActivityChange) async -> [String: Any] {
        if let on = change.on {
            Saved.on = on
            if on { Saved.dismissed = nil }
        }
        if let hide = change.hideTitles { Saved.hidden = hide }
        if let style = change.style { Saved.style = style }
        if !change.isQuery { await sync(.setting) }
        return [
            "supported": Self.isSupported,
            "enabled": ActivityAuthorizationInfo().areActivitiesEnabled,
            "on": Saved.on,
            "hideTitles": Saved.hidden,
            "style": Saved.style.rawValue,
            "showing": !live().isEmpty,
        ]
    }

    /// One request, after any before it has finished.
    func sync(_ trigger: LiveNowPolicy.Trigger) async {
        let previous = tail
        let job = Task { @MainActor in
            await previous?.value
            await self.perform(trigger)
        }
        tail = job
        await job.value
    }

    // MARK: - Doing it

    private func perform(_ trigger: LiveNowPolicy.Trigger) async {
        guard !AppEnvironment.smokeTest else { return }
        // Show Now is a request to have it: it switches the setting on.
        if trigger == .show { Saved.on = true }
        let date = Date()
        let calendar = Calendar.current
        let current = await reconcile(date: date, today: WidgetTimeline.dayString(date, calendar: calendar))
        let input = LiveNowPolicy.Input(
            trigger: trigger, date: date, on: Saved.on, allowed: ActivityAuthorizationInfo().areActivitiesEnabled,
            active: UIApplication.shared.applicationState == .active, reading: reading(),
            running: current.map { LiveNowPolicy.Running(started: Saved.started ?? date, state: $0.content.state) },
            dismissed: Saved.dismissed, style: Saved.style, hidden: Saved.hidden, calendar: calendar)
        let action = LiveNowPolicy.decide(input)
        switch action {
        case .nothing:
            break
        case .start(let state):
            await start(state)
        case .update(let state):
            if let current { await update(current, state) }
        case .rotate(let state):
            if await start(state), let current { await end(current, last: nil, dismissAt: nil) }
        case .end(let last, let dismissAt):
            for activity in live() { await end(activity, last: last, dismissAt: dismissAt) }
        }
        if action != .nothing { say("\(trigger.rawValue) → \(String(describing: action).prefix(60))") }
        scheduleTick()
    }

    /// The activity that's up, if any. Extras, ones the app doesn't know and ones from another build are ended (a
    /// reinstall can leave one drawn blank); one that's gone without the app ending it was swiped away, and stays away
    /// for the rest of the day.
    private func reconcile(date: Date, today: String) async -> Activity<NowActivityAttributes>? {
        let all = live()
        var keep = all.first { $0.id == Saved.id }
        for activity in all where activity.id != keep?.id { await end(activity, last: nil, dismissAt: nil) }
        if let k = keep, k.attributes.v != NowActivityAttributes.version || Saved.build != Self.install {
            await end(k, last: nil, dismissAt: nil)
            keep = nil
        }
        if keep == nil, let id = Saved.id {
            if Saved.ended != id, let started = Saved.started, LiveNowPolicy.swipedAway(started: started, now: date) {
                Saved.dismissed = today
            }
            Saved.id = nil
            Saved.started = nil
        }
        if let keep { watch(keep) }
        return keep
    }

    /// Ours that are on show: running, or past their turn.
    private func live() -> [Activity<NowActivityAttributes>] {
        Activity<NowActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }

    private func reading() -> LiveNowPolicy.Reading {
        if let heard = lastHeard { return heard.map { LiveNowPolicy.Reading.snapshot($0) } ?? .signedOut }
        guard let store = WidgetShared.store else { return .unreadable }
        do {
            return try store.read().map { LiveNowPolicy.Reading.snapshot($0) } ?? .signedOut
        } catch {
            return .unreadable
        }
    }

    private func content(_ state: LiveNowState) -> ActivityContent<LiveNowState> {
        ActivityContent(state: state, staleDate: state.turn, relevanceScore: 50)
    }

    @discardableResult
    private func start(_ state: LiveNowState) async -> Bool {
        // One that ran out its eight hours lingers on the Lock Screen: never two of them.
        for old in Activity<NowActivityAttributes>.activities where old.activityState == .ended {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        do {
            let activity = try Activity.request(attributes: NowActivityAttributes(), content: content(state), pushType: nil)
            Saved.id = activity.id
            Saved.started = Date()
            Saved.build = Self.install
            watch(activity)
            return true
        } catch {
            say("couldn’t start: \(error.localizedDescription)")
            return false
        }
    }

    private func update(_ activity: Activity<NowActivityAttributes>, _ state: LiveNowState) async {
        if #available(iOS 17.2, *) {
            // Timestamped, so an older update arriving late can't undo a newer one.
            await activity.update(content(state), alertConfiguration: nil, timestamp: state.made)
        } else {
            await activity.update(content(state))
        }
    }

    private func end(_ activity: Activity<NowActivityAttributes>, last: LiveNowState?, dismissAt: Date?) async {
        Saved.ended = activity.id
        let policy: ActivityUIDismissalPolicy = dismissAt.map { .after($0) } ?? .immediate
        await activity.end(last.map { content($0) }, dismissalPolicy: policy)
        if activity.id == Saved.id {
            Saved.id = nil
            Saved.started = nil
        }
    }

    /// Notices a swipe-away while the app runs.
    private func watch(_ activity: Activity<NowActivityAttributes>) {
        guard watched.insert(activity.id).inserted else { return }
        Task { @MainActor [weak self] in
            for await state in activity.activityStateUpdates where state == .dismissed {
                if activity.id == Saved.id, Saved.ended != activity.id, let started = Saved.started,
                   LiveNowPolicy.swipedAway(started: started, now: Date()) {
                    Saved.dismissed = WidgetTimeline.dayString(Date())
                }
                if activity.id == Saved.id {
                    Saved.id = nil
                    Saved.started = nil
                }
                break
            }
            self?.watched.remove(activity.id)
        }
    }

    /// While the app is in front, the activity turns on time: a sync at its next turn.
    private func scheduleTick() {
        tick?.cancel()
        tick = nil
        guard UIApplication.shared.applicationState == .active, let turn = live().first?.content.state.turn else { return }
        let wait = turn.timeIntervalSinceNow + 1
        guard wait > 0, wait < 12 * 3600 else { return }
        tick = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await NowActivityController.shared.sync(.tick)
        }
    }

    private func say(_ line: String) {
        if AppEnvironment.isDebug { SmokeTest.say("LIS-LIVE \(line)") }
    }
}
