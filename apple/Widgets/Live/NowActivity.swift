import ActivityKit
import AppIntents
import LifeIsShortCore

// The Lock Screen's Now: a Live Activity with what's pending right now, on the Lock Screen and in the Dynamic Island
// (docs/apple.md → Live Activity). Compiled into the app, which starts and updates it (iOS/NowActivityController.swift),
// and into the widget extension, which draws it (Extension/NowActivityWidget.swift) and whose buttons name these
// intents. What it shows is LiveNowState, worked out in the core (LiveNow.swift).

/// The activity: nothing fixed for its life but the shape of its state, which may change in a later build.
struct NowActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveNowState

    static let version = 1
    var v: Int = NowActivityAttributes.version
}

/// Where the intents reach the app's controller. The app fills it in as it launches; in the widget extension it stays
/// empty, which is right: iOS runs a LiveActivityIntent in the app's process, never the extension's.
@MainActor
enum NowActivityHub {
    static var sync: ((LiveNowPolicy.Trigger) async -> Void)?
}

/// Refresh, on the Live Activity: brings it up to date from the planner's last word without opening the app, and swaps
/// in a fresh one when this one is nearly out of hours.
struct RefreshNowIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Refresh Now"
    static let description = IntentDescription("Brings Now on the Lock Screen up to date, without opening the app.")
    static let isDiscoverable = false
    /// A Lock Screen tap shouldn't need the phone unlocked: it only redraws what's already on the Lock Screen.
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        await NowActivityHub.sync?(.refresh)
        return .result()
    }
}

/// Show Now on the Lock Screen: from Shortcuts (at set times, say), Siri, the Action button or the control. Turns the
/// setting on, puts the activity up if it isn't, even after a swipe-away, and brings it up to date.
struct ShowNowIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Show Now on the Lock Screen"
    static let description = IntentDescription("Puts what's pending right now on the Lock Screen and in the Dynamic Island, or brings it up to date.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        await NowActivityHub.sync?(.show)
        return .result()
    }
}
