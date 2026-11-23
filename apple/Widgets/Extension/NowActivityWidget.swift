import ActivityKit
import AppIntents
import LifeIsShortCore
import SwiftUI
import WidgetKit

// The Lock Screen's Now, drawn: the Live Activity the app starts and updates (iOS/NowActivityController.swift), on the
// Lock Screen and in the Dynamic Island. Its views are Design/NowActivityViews.swift.

struct NowActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NowActivityAttributes.self) { context in
            NowActivityLockView(model: model(context))
        } dynamicIsland: { context in
            let m = model(context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading, priority: 1) {
                    IslandExpandedLeading(m: m)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandExpandedTrailing(m: m)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    IslandExpandedBottom(m: m)
                }
            } compactLeading: {
                IslandGlyph(m: m, size: 22)
            } compactTrailing: {
                IslandTrailing(m: m).frame(maxWidth: 52, alignment: .trailing)
            } minimal: {
                IslandGlyph(m: m, size: 24)
            }
            .widgetURL(m.url)
            .keylineTint(nowActivityKeyline(m))
        }
    }

    private func model(_ context: ActivityViewContext<NowActivityAttributes>) -> NowActivityModel {
        NowActivityModel(state: context.state, isStale: context.isStale, live: true, bundle: .main)
    }
}

/// Show Now as a control (iOS 18): in Control Center, on the Lock Screen's bottom corners or the Action button, a tap
/// puts Now on the Lock Screen or brings it up to date, without opening the app.
@available(iOS 18.0, *)
struct NowControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "LifeIsShortNowControl") {
            ControlWidgetButton(action: ShowNowIntent()) {
                Label("Show Now", systemImage: "pin")
            }
        }
        .displayName("Show Now")
        .description("Puts what’s pending right now on the Lock Screen, or brings it up to date.")
    }
}
