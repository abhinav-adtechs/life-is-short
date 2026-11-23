import Foundation
import LifeIsShortCore
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// CI's smoke test (apple/scripts/smoke.sh) runs the app against a local copy of the planner with
/// `-LISSmokeTest YES -LISServerURL http://localhost:3000 -LISSmokeShot <name>.png`. It passes when the planner loads,
/// says `ready` through the bridge and answers a `ping` command (the round trip both ways); it saves a snapshot in the
/// app's own caches folder, which the Mac's sandbox allows, and quits. Every line it prints starts with LIS-SMOKE.
/// On an iPhone it also draws every widget (iOS/WidgetGallery.swift) and says what the planner told the widgets.
@MainActor
final class SmokeTest {
    private weak var controller: WebController?
    private var finished = false

    init(controller: WebController) {
        self.controller = controller
        Self.say("LIS-SMOKE start \(AppEnvironment.platform) \(AppEnvironment.server?.absoluteString ?? "no server")")
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 120_000_000_000)
            self?.failed("timeout: the planner never said ready")
        }
    }

    func plannerReady() {
        guard !finished else { return }
        Self.say("LIS-SMOKE ready")
        controller?.handle(.ping)
    }

    /// The planner handed the widgets today's picture (or emptied them).
    func widgetHeard(_ snapshot: WidgetSnapshot?) {
        guard let snapshot else { return Self.say("LIS-SMOKE widget-data cleared") }
        let today = "\(snapshot.today.done) of \(snapshot.today.total) done today"
        Self.say("LIS-SMOKE widget-data \(snapshot.items.count) items, \(today), \(snapshot.outcomes == nil ? "not planned" : "planned")")
    }

    func pong() {
        guard !finished, let webView = controller?.webView else { return }
        finished = true
        Self.say("LIS-SMOKE pong")
        // Let the rows rise in and the fonts settle before the picture.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            #if os(iOS)
            if UIDevice.current.userInterfaceIdiom == .phone {
                for shot in WidgetGallery.render(into: caches) { Self.say("LIS-SMOKE widget-shot \(shot.path)") }
            }
            #endif
            let file = caches.appendingPathComponent(AppEnvironment.smokeShot ?? "smoke.png")
            webView.takeSnapshot(with: nil) { image, error in
                do {
                    guard let data = image.flatMap({ Self.png($0) }) else { throw error ?? CocoaError(.fileWriteUnknown) }
                    try FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
                    try data.write(to: file)
                    Self.say("LIS-SMOKE shot \(file.path)")
                } catch {
                    Self.say("LIS-SMOKE shot-failed \(error.localizedDescription)")
                }
                Self.say("LIS-SMOKE pass")
                exit(0)
            }
        }
    }

    func failed(_ reason: String) {
        guard !finished else { return }
        finished = true
        Self.say("LIS-SMOKE fail \(reason)")
        exit(1)
    }

    /// A line on standard output, flushed at once: the script may stop the app at any moment.
    nonisolated static func say(_ line: String) {
        print(line)
        fflush(stdout)
    }

    #if os(iOS)
    nonisolated private static func png(_ image: UIImage) -> Data? { image.pngData() }
    #else
    nonisolated private static func png(_ image: NSImage) -> Data? {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
    #endif
}
