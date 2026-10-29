import XCTest
@testable import LifeIsShortCore

final class BridgeRequestTests: XCTestCase {
    func testSimpleMessages() {
        XCTAssertEqual(BridgeRequest.parse(["type": "ready"]), .ready)
        XCTAssertEqual(BridgeRequest.parse(["type": "pong"]), .pong)
        XCTAssertEqual(BridgeRequest.parse(["type": "page.retry"]), .retry)
        XCTAssertEqual(BridgeRequest.parse(["type": "appearance", "background": "rgb(13, 17, 23)"]), .appearance(background: "rgb(13, 17, 23)"))
        XCTAssertEqual(BridgeRequest.parse(["type": "server.set", "address": "x.app"]), .setServer(address: "x.app"))
    }

    func testHaptics() {
        XCTAssertEqual(BridgeRequest.parse(["type": "haptic", "kind": "success"]), .haptic(.success))
        XCTAssertNil(BridgeRequest.parse(["type": "haptic", "kind": "boom"]))
        XCTAssertNil(BridgeRequest.parse(["type": "haptic"]))
    }

    func testShare() {
        let link = URL(string: "https://lis.example.com/shared#abc")!
        XCTAssertEqual(BridgeRequest.parse(["type": "share", "title": "My planner", "url": link.absoluteString]),
                       .share(title: "My planner", text: nil, url: link))
        XCTAssertEqual(BridgeRequest.parse(["type": "share", "text": "hello"]), .share(title: nil, text: "hello", url: nil))
        XCTAssertNil(BridgeRequest.parse(["type": "share", "url": "javascript:alert(1)"]))
        XCTAssertNil(BridgeRequest.parse(["type": "share"]))
    }

    func testExternalLinksAreLimitedToSafeSchemes() {
        XCTAssertEqual(BridgeRequest.parse(["type": "external.open", "url": "https://example.com"]), .openExternal(URL(string: "https://example.com")!))
        XCTAssertEqual(BridgeRequest.parse(["type": "external.open", "url": "mailto:me@example.com"]), .openExternal(URL(string: "mailto:me@example.com")!))
        XCTAssertNil(BridgeRequest.parse(["type": "external.open", "url": "file:///etc/hosts"]))
        XCTAssertNil(BridgeRequest.parse(["type": "external.open", "url": "lifeisshort://dump"]))
    }

    func testSpeech() {
        XCTAssertEqual(BridgeRequest.parse(["type": "speech.start", "id": "3", "lang": "en-IN", "interim": true, "onDevice": true] as [String: Any]),
                       .speechStart(id: "3", lang: "en-IN", interim: true, onDevice: true))
        XCTAssertEqual(BridgeRequest.parse(["type": "speech.start", "id": "4"]), .speechStart(id: "4", lang: nil, interim: false, onDevice: false))
        XCTAssertEqual(BridgeRequest.parse(["type": "speech.stop", "id": "3"]), .speechStop(id: "3"))
        XCTAssertEqual(BridgeRequest.parse(["type": "speech.abort", "id": "3"]), .speechAbort(id: "3"))
        XCTAssertEqual(BridgeRequest.parse(["type": "speech.available", "lang": "en-US", "onDevice": true] as [String: Any]), .speechAvailability(lang: "en-US", onDevice: true))
        XCTAssertNil(BridgeRequest.parse(["type": "speech.start"]))
        XCTAssertNil(BridgeRequest.parse(["type": "speech.stop", "id": ""]))
        XCTAssertNil(BridgeRequest.parse(["type": "speech.stop", "id": String(repeating: "x", count: 65)]))
    }

    func testLogLinesAreCapped() {
        XCTAssertEqual(BridgeRequest.parse(["type": "log", "message": "TypeError: x"]), .log("TypeError: x"))
        XCTAssertEqual(BridgeRequest.parse(["type": "log", "message": String(repeating: "x", count: 3000)]), .log(String(repeating: "x", count: 2000)))
        XCTAssertEqual(BridgeRequest.log("x").allowed, [.planner, .local])
    }

    func testMalformed() {
        XCTAssertNil(BridgeRequest.parse("ready"))
        XCTAssertNil(BridgeRequest.parse(["kind": "ready"]))
        XCTAssertNil(BridgeRequest.parse(["type": "eval", "code": "1"]))
        XCTAssertNil(BridgeRequest.parse(["type": "appearance", "background": String(repeating: "x", count: 200)]))
    }

    func testWhoMaySendWhat() {
        XCTAssertEqual(BridgeRequest.setServer(address: "x").allowed, [.local])
        XCTAssertEqual(BridgeRequest.retry.allowed, [.local])
        XCTAssertEqual(BridgeRequest.appearance(background: "#fff").allowed, [.planner, .local])
        XCTAssertEqual(BridgeRequest.speechStart(id: "1", lang: nil, interim: true, onDevice: false).allowed, [.planner])
        XCTAssertEqual(BridgeRequest.share(title: nil, text: "x", url: nil).allowed, [.planner])
        XCTAssertEqual(BridgeRequest.ready.allowed, [.planner])
    }
}
