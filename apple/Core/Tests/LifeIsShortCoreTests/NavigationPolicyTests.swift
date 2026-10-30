import XCTest
@testable import LifeIsShortCore

final class NavigationPolicyTests: XCTestCase {
    private let pages = URL(fileURLWithPath: "/Applications/Life is short.app/Contents/Resources/Pages")
    private var policy: NavigationPolicy { NavigationPolicy(server: URL(string: "https://lis.example.com")!, localPages: pages) }

    private func decide(_ link: String, mainFrame: Bool = true) -> NavigationDecision {
        policy.decide(URL(string: link), mainFrame: mainFrame)
    }

    func testThePlannerStaysInTheWindow() {
        XCTAssertEqual(decide("https://lis.example.com/app"), .allow)
        XCTAssertEqual(decide("https://lis.example.com/app#settings/google"), .allow)
        XCTAssertEqual(decide("https://LIS.example.com:443/app/"), .allow)
        XCTAssertEqual(decide("https://lis.example.com/google/callback?code=1&state=app.2"), .allow)
    }

    func testTheServersOtherPagesGoToTheBrowser() {
        let home = URL(string: "https://lis.example.com")!
        XCTAssertEqual(policy.decide(home, mainFrame: true), .openExternally(home))
        let privacy = URL(string: "https://lis.example.com/privacy")!
        XCTAssertEqual(policy.decide(privacy, mainFrame: true), .openExternally(privacy))
        XCTAssertEqual(policy.decide(privacy, mainFrame: false), .allow)
        let plain = URL(string: "http://lis.example.com/app")!
        XCTAssertEqual(policy.decide(plain, mainFrame: true), .openExternally(plain))
    }

    func testGoogleSignInGoesToTheSystemSheet() {
        let consent = URL(string: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=app.1")!
        XCTAssertEqual(policy.decide(consent, mainFrame: true), .signInWithGoogle(consent))
        XCTAssertEqual(policy.decide(consent, mainFrame: false), .cancel)
        let other = URL(string: "https://accounts.google.com/ServiceLogin")!
        XCTAssertEqual(policy.decide(other, mainFrame: true), .openExternally(other))
    }

    func testOtherLinksLeaveTheApp() {
        let calendar = URL(string: "https://calendar.google.com/calendar/render?action=TEMPLATE")!
        XCTAssertEqual(policy.decide(calendar, mainFrame: true), .openExternally(calendar))
        XCTAssertEqual(policy.decide(calendar, mainFrame: false), .cancel)
        let mail = URL(string: "mailto:me@example.com")!
        XCTAssertEqual(policy.decide(mail, mainFrame: true), .openExternally(mail))
    }

    func testTheAppsOwnLinksAndInternals() {
        let link = URL(string: "lifeisshort://dump?text=hi")!
        XCTAssertEqual(policy.decide(link, mainFrame: true), .deepLink(link))
        XCTAssertEqual(decide("about:blank"), .allow)
        XCTAssertEqual(decide("about:srcdoc", mainFrame: false), .allow)
        XCTAssertEqual(policy.decide(nil, mainFrame: true), .cancel)
    }

    func testOnlyTheBundledPagesLoadFromFiles() {
        XCTAssertEqual(policy.decide(pages.appendingPathComponent("start.html"), mainFrame: true), .allow)
        XCTAssertEqual(policy.decide(URL(fileURLWithPath: "/etc/hosts"), mainFrame: true), .cancel)
        XCTAssertEqual(policy.decide(URL(fileURLWithPath: pages.path + "Evil/start.html"), mainFrame: true), .cancel)
        let none = NavigationPolicy(server: nil, localPages: nil)
        XCTAssertEqual(none.decide(pages.appendingPathComponent("start.html"), mainFrame: true), .cancel)
    }

    func testWithoutAServerNothingRemoteLoads() {
        let setup = NavigationPolicy(server: nil, localPages: pages)
        let site = URL(string: "https://lis.example.com/app")!
        XCTAssertEqual(setup.decide(site, mainFrame: true), .openExternally(site))
    }

    func testPlannerPages() {
        XCTAssertTrue(NavigationPolicy.isPlannerPage(URL(string: "https://x.app/app")!))
        XCTAssertTrue(NavigationPolicy.isPlannerPage(URL(string: "https://x.app/app/today")!))
        XCTAssertFalse(NavigationPolicy.isPlannerPage(URL(string: "https://x.app/apple")!))
        XCTAssertFalse(NavigationPolicy.isPlannerPage(URL(string: "https://x.app/shared")!))
    }
}
