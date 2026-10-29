import Foundation
import LifeIsShortCore
#if os(iOS)
import UIKit
#endif

/// The app's settings: which server, which version, and how it was launched.
enum AppEnvironment {
    /// The server address in UserDefaults, chosen on the setup page or passed as a launch argument
    /// (`-LISServerURL <address>`), and in Info.plist, from LIS_SERVER in the build's xcconfig.
    static let serverKey = "LISServerURL"

    /// The planner's server: the one chosen in the app, else the one the build was made for. Nil when neither is set,
    /// and the app asks.
    static var server: URL? {
        if let chosen = UserDefaults.standard.string(forKey: serverKey), let url = ServerAddress.normalize(chosen) { return url }
        if let built = Bundle.main.object(forInfoDictionaryKey: serverKey) as? String, let url = ServerAddress.normalize(built) { return url }
        return nil
    }

    static func choose(server: URL) {
        UserDefaults.standard.set(server.absoluteString, forKey: serverKey)
    }

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0" }

    /// Launched by the CI smoke test (apple/scripts/smoke.sh): `-LISSmokeTest YES -LISSmokeShot <file name>`.
    static var smokeTest: Bool { UserDefaults.standard.bool(forKey: "LISSmokeTest") }
    static var smokeShot: String? { UserDefaults.standard.string(forKey: "LISSmokeShot") }

    static var isDebug: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// What the page sees as lisNative.platform.
    @MainActor static var platform: String {
        #if os(iOS)
        return UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #else
        return "macos"
        #endif
    }
}

/// Commands for the planner that arrive before there's a window to take them: Siri and quick actions can launch the app.
@MainActor
final class CommandCenter {
    static let shared = CommandCenter()

    private var waiting: [NativeCommand] = []
    private var handler: ((NativeCommand) -> Void)?

    func post(_ command: NativeCommand) {
        if let handler { handler(command) } else { waiting.append(command) }
    }

    /// The window's web controller takes every command from here on, starting with any that were waiting.
    func setHandler(_ handler: @escaping (NativeCommand) -> Void) {
        self.handler = handler
        let queued = waiting
        waiting = []
        queued.forEach(handler)
    }
}
