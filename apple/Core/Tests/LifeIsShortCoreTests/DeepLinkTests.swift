import XCTest
@testable import LifeIsShortCore

final class DeepLinkTests: XCTestCase {
    private func command(_ link: String) -> NativeCommand? { DeepLink.command(from: URL(string: link)!) }

    func testDump() {
        XCTAssertEqual(command("lifeisshort://dump"), .dump(text: nil))
        XCTAssertEqual(command("lifeisshort://dump?text=Call%20mum%20tomorrow%20at%209"), .dump(text: "Call mum tomorrow at 9"))
        XCTAssertEqual(command("lifeisshort://dump?text=%20%20"), .dump(text: nil))
        XCTAssertEqual(command("lifeisshort://add?text=x"), .dump(text: "x"))
    }

    func testLongDumpsAreCapped() {
        let long = String(repeating: "a", count: DeepLink.maxText + 50)
        XCTAssertEqual(command("lifeisshort://dump?text=\(long)"), .dump(text: String(repeating: "a", count: DeepLink.maxText)))
    }

    func testOtherCommands() {
        XCTAssertEqual(command("lifeisshort://listen"), .listen)
        XCTAssertEqual(command("LIFEISSHORT://LISTEN"), .listen)
        XCTAssertEqual(command("lifeisshort://settings"), .open(.settings))
        XCTAssertEqual(command("lifeisshort://analytics"), .open(.analytics))
        XCTAssertEqual(command("lifeisshort://review"), .open(.review))
        XCTAssertEqual(command("lifeisshort://share"), .open(.share))
    }

    func testGoogleCallback() {
        XCTAssertEqual(command("lifeisshort://google/callback?code=4%2F0AQ&state=app.123&scope=x"),
                       .googleCallback(query: "code=4%2F0AQ&state=app.123&scope=x"))
        XCTAssertEqual(command("lifeisshort://google/callback"), .googleCallback(query: ""))
        XCTAssertNil(command("lifeisshort://google"))
    }

    func testUnknownLinks() {
        XCTAssertNil(command("lifeisshort://nope"))
        XCTAssertNil(command("https://example.com/dump"))
        XCTAssertNil(command("other://dump"))
    }

    func testShortcuts() {
        XCTAssertEqual(DeepLink.command(forShortcut: "dump"), .dump(text: nil))
        XCTAssertEqual(DeepLink.command(forShortcut: "listen"), .listen)
        XCTAssertNil(DeepLink.command(forShortcut: "other"))
    }

    func testPayloads() {
        XCTAssertEqual(NativeCommand.dump(text: nil).payload, ["name": "dump"])
        XCTAssertEqual(NativeCommand.dump(text: "Call mum").payload, ["name": "dump", "text": "Call mum"])
        XCTAssertEqual(NativeCommand.listen.payload, ["name": "listen"])
        XCTAssertEqual(NativeCommand.open(.review).payload, ["name": "open", "sheet": "review"])
        XCTAssertEqual(NativeCommand.ping.payload, ["name": "ping"])
        XCTAssertNil(NativeCommand.googleCallback(query: "code=1").payload)
    }

    func testGoogleCallbackURL() {
        let server = URL(string: "https://lis.example.com")!
        XCTAssertEqual(DeepLink.googleCallbackURL(server: server, query: "code=4%2F0AQ&state=app.1")?.absoluteString,
                       "https://lis.example.com/google/callback?code=4%2F0AQ&state=app.1")
        XCTAssertEqual(DeepLink.googleCallbackURL(server: URL(string: "http://localhost:3000")!, query: "")?.absoluteString,
                       "http://localhost:3000/google/callback")
        XCTAssertNil(DeepLink.googleCallbackURL(server: server, query: "code=1#evil"))
        XCTAssertNil(DeepLink.googleCallbackURL(server: server, query: "code=1 2"))
    }
}
