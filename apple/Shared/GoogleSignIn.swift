import AuthenticationServices
import Foundation
import LifeIsShortCore

/// Connect Google in the system's sign-in sheet. Google refuses sign-in inside an app's web view; the sheet is Safari's
/// own, so it already knows your Google accounts. The planner's callback page hands Google's answer back through the
/// app's link (lifeisshort://google/callback), which the sheet catches and gives to `completion`.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var completion: ((URL?) -> Void)?
    private weak var anchor: ASPresentationAnchor?

    /// `completion` gets the app link Google's answer came back on, or nil if it was cancelled or failed.
    func start(_ url: URL, anchor: ASPresentationAnchor?, completion: @escaping (URL?) -> Void) {
        session?.cancel()
        self.anchor = anchor
        self.completion = completion
        let handler: @Sendable (URL?, Error?) -> Void = { [weak self] callback, _ in
            Task { @MainActor in self?.finish(callback) }
        }
        let sheet: ASWebAuthenticationSession
        if #available(iOS 17.4, macOS 14.4, *) {
            sheet = ASWebAuthenticationSession(url: url, callback: .customScheme(DeepLink.scheme), completionHandler: handler)
        } else {
            sheet = ASWebAuthenticationSession(url: url, callbackURLScheme: DeepLink.scheme, completionHandler: handler)
        }
        sheet.presentationContextProvider = self
        // Share Safari's cookies, so Google offers the accounts you're already signed in to.
        sheet.prefersEphemeralWebBrowserSession = false
        session = sheet
        if !sheet.start() { finish(nil) }
    }

    private func finish(_ callback: URL?) {
        session = nil
        let done = completion
        completion = nil
        done?(callback)
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { anchor ?? ASPresentationAnchor() }
    }
}
