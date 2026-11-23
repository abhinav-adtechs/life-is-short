import AppIntents
import LifeIsShortCore
import SwiftUI
import WidgetKit

// The widgets: Now on the Home Screen (small, medium, large; the window or your theme) and on the lock screen. The
// app keeps today's picture in the App Group whenever the planner changes it (iOS/WidgetBridge.swift); each widget's
// timeline has an entry at every moment that changes what it shows (WidgetTimeline), so it stays right until the app
// is next open.

@main
struct LifeIsShortWidgets: WidgetBundle {
    init() {
        WidgetFonts.register(from: .main)
    }

    var body: some Widget {
        NowWidget()
        NowLockWidget()
    }
}

struct NowEntry: TimelineEntry {
    let date: Date
    let moment: WidgetMoment
    let style: WidgetStyle
}

/// The timeline both widgets share.
enum NowTimeline {
    /// How far ahead a timeline runs, and so how often WidgetKit asks again even when the app hasn't said anything.
    static let span: TimeInterval = 6 * 3600

    static func entry(at date: Date, snapshot: WidgetSnapshot?, style: WidgetStyle) -> NowEntry {
        NowEntry(date: date, moment: WidgetTimeline.moment(at: date, snapshot: snapshot), style: style)
    }

    /// Before the app has said anything, the widget gallery shows the sample day.
    static func preview(style: WidgetStyle, isPreview: Bool) -> NowEntry {
        let now = Date()
        let snapshot = WidgetShared.store?.load() ?? (isPreview ? WidgetSamples.snapshot(on: now) : nil)
        return entry(at: now, snapshot: snapshot, style: style)
    }

    /// `tick`: entries every so often while a slot runs, for widgets that can't run a bar by themselves.
    static func timeline(style: WidgetStyle, tick: TimeInterval? = nil) -> Timeline<NowEntry> {
        let now = Date()
        let until = now.addingTimeInterval(span)
        let snapshot = WidgetShared.store?.load()
        var dates = Set([now] + WidgetTimeline.changes(after: now, until: until, snapshot: snapshot))
        if let tick {
            var t = now
            while t < until {
                t = t.addingTimeInterval(tick)
                if WidgetTimeline.moment(at: t, snapshot: snapshot).live { dates.insert(t) }
            }
        }
        let entries = dates.sorted().prefix(120).map { entry(at: $0, snapshot: snapshot, style: style) }
        return Timeline(entries: entries, policy: .after(until))
    }
}

// MARK: - Home Screen

/// The widget's look, in its Edit Widget menu.
enum NowLook: String, AppEnum {
    case window, theme

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Look"
    static let caseDisplayRepresentations: [NowLook: DisplayRepresentation] = [
        .window: DisplayRepresentation(title: "The window", subtitle: "The view from the train, by time of day"),
        .theme: DisplayRepresentation(title: "Your theme", subtitle: "Tide, Day train or Night train, as in the app"),
    ]

    var style: WidgetStyle { self == .theme ? .theme : .window }
}

struct NowLookIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Look"

    @Parameter(title: "Look", default: .window)
    var look: NowLook
}

struct NowProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NowEntry {
        NowTimeline.entry(at: Date(), snapshot: WidgetSamples.snapshot(on: Date()), style: .window)
    }

    func snapshot(for configuration: NowLookIntent, in context: Context) async -> NowEntry {
        NowTimeline.preview(style: configuration.look.style, isPreview: context.isPreview)
    }

    func timeline(for configuration: NowLookIntent, in context: Context) async -> Timeline<NowEntry> {
        NowTimeline.timeline(style: configuration.look.style)
    }
}

struct NowWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetShared.nowKind, intent: NowLookIntent.self, provider: NowProvider()) { entry in
            NowWidgetView(model: NowModel(moment: entry.moment, style: entry.style, live: true, bundle: .main))
        }
        .configurationDisplayName("Now")
        .description("The one thing to do now, how long you have for it, and what comes next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

// MARK: - Lock screen

struct NowLockProvider: TimelineProvider {
    func placeholder(in context: Context) -> NowEntry {
        NowTimeline.entry(at: Date(), snapshot: WidgetSamples.snapshot(on: Date()), style: .theme)
    }

    func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) {
        completion(NowTimeline.preview(style: .theme, isPreview: context.isPreview))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
        // The round one shows what's left of a slot as a gauge, which moves only between entries.
        completion(NowTimeline.timeline(style: .theme, tick: context.family == .accessoryCircular ? 5 * 60 : nil))
    }
}

struct NowLockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetShared.lockKind, provider: NowLockProvider()) { entry in
            NowWidgetView(model: NowModel(moment: entry.moment, style: entry.style, live: true, bundle: .main))
        }
        .configurationDisplayName("Now")
        .description("The task you’re on, and how long you have for it.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}
