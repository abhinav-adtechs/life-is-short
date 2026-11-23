import Foundation
import LifeIsShortCore
import WidgetKit

/// Hands the widgets what the planner says about today (BridgeRequest.widget): kept in the App Group, and the widgets
/// told to look again, only when it changed. WidgetKit doesn't count reloads while the app is in front against the
/// widgets' daily allowance, so every change can go.
@MainActor
enum WidgetBridge {
    static func update(_ snapshot: WidgetSnapshot?) {
        guard let store = WidgetShared.store else { return }
        do {
            if try store.save(snapshot) { WidgetCenter.shared.reloadAllTimelines() }
        } catch {
            if AppEnvironment.isDebug { SmokeTest.say("LIS-WIDGET couldn’t keep today’s picture: \(error.localizedDescription)") }
        }
    }
}
