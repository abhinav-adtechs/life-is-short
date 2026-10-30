import AppIntents
import LifeIsShortCore

// Siri, Shortcuts, Spotlight and the Action button. Each opens the app and hands the planner a command, which waits
// until the planner is up and unlocked (CommandCenter, then WebController).

struct DumpThoughtIntent: AppIntent {
    static let title: LocalizedStringResource = "Dump a Thought"
    static let openAppWhenRun = true

    @Parameter(title: "Thought", requestValueDialog: "What’s on your mind?")
    var text: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        CommandCenter.shared.post(.dump(text: DeepLink.cleanText(text)))
        return .result()
    }
}

struct SpeakIntent: AppIntent {
    static let title: LocalizedStringResource = "Speak to Life is short"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        CommandCenter.shared.post(.listen)
        return .result()
    }
}

struct ReviewIntent: AppIntent {
    static let title: LocalizedStringResource = "Review My Week"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        CommandCenter.shared.post(.open(.review))
        return .result()
    }
}

struct LifeIsShortShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DumpThoughtIntent(),
            phrases: ["Dump a thought in \(.applicationName)", "Add to \(.applicationName)", "Tell \(.applicationName)"],
            shortTitle: "Dump a Thought",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: SpeakIntent(),
            phrases: ["Talk to \(.applicationName)", "Speak to \(.applicationName)"],
            shortTitle: "Speak",
            systemImageName: "mic"
        )
        AppShortcut(
            intent: ReviewIntent(),
            phrases: ["Review my week in \(.applicationName)", "How did my week go in \(.applicationName)"],
            shortTitle: "Review",
            systemImageName: "chart.bar"
        )
    }
}
