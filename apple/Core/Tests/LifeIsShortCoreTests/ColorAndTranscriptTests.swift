import XCTest
@testable import LifeIsShortCore

final class CSSColorTests: XCTestCase {
    private func assertColor(_ css: String, _ r: Double, _ g: Double, _ b: Double, _ a: Double = 1, file: StaticString = #filePath, line: UInt = #line) {
        guard let c = RGBA.parse(css) else { return XCTFail("\(css) didn't parse", file: file, line: line) }
        XCTAssertEqual(c.red, r, accuracy: 0.002, file: file, line: line)
        XCTAssertEqual(c.green, g, accuracy: 0.002, file: file, line: line)
        XCTAssertEqual(c.blue, b, accuracy: 0.002, file: file, line: line)
        XCTAssertEqual(c.alpha, a, accuracy: 0.002, file: file, line: line)
    }

    func testComputedStyleForms() {
        assertColor("rgb(237, 242, 244)", 237 / 255, 242 / 255, 244 / 255)
        assertColor("rgba(0, 0, 0, 0.5)", 0, 0, 0, 0.5)
        assertColor("rgb(13 17 23 / 80%)", 13 / 255, 17 / 255, 23 / 255, 0.8)
        assertColor("color(srgb 0.1 0.2 0.3)", 0.1, 0.2, 0.3)
        assertColor("color(srgb 1 1 1 / 0.25)", 1, 1, 1, 0.25)
        assertColor("transparent", 0, 0, 0, 0)
    }

    func testHex() {
        assertColor("#0D1117", 13 / 255, 17 / 255, 23 / 255)
        assertColor("#fff", 1, 1, 1)
        assertColor("#0d111780", 13 / 255, 17 / 255, 23 / 255, 128 / 255)
    }

    func testRejects() {
        for css in ["", "oklch(0.5 0.1 200)", "rgb(1, 2)", "rgb(a, b, c)", "#12", "#ggg", "blue", "rgb(1, 2, 3"] {
            XCTAssertNil(RGBA.parse(css), css)
        }
    }

    func testThemesPickTheRightStatusBarText() {
        // The page backgrounds of Tide, Night train and Day train (app/globals.css, --bg).
        XCTAssertFalse(RGBA.parse("#EDF2F4")!.isDark)
        XCTAssertTrue(RGBA.parse("#0D1117")!.isDark)
        XCTAssertFalse(RGBA.parse("#F3EEE4")!.isDark)
        XCTAssertTrue(RGBA.parse("#000")!.isDark)
        XCTAssertFalse(RGBA.parse("#fff")!.isDark)
    }
}

final class TranscriptTests: XCTestCase {
    func testCumulativeResults() {
        var t = Transcript()
        t.update("call", isFinal: false)
        t.update("call mum", isFinal: false)
        XCTAssertEqual(t.segments, [.init(text: "call mum", isFinal: false)])
        t.update("Call mum tomorrow.", isFinal: true)
        XCTAssertEqual(t.segments, [.init(text: "Call mum tomorrow.", isFinal: true)])
        XCTAssertEqual(t.text, "Call mum tomorrow.")
    }

    func testAFreshTranscriptionAfterAPauseKeepsTheEarlierWords() {
        var t = Transcript()
        t.update("Call the plumber tomorrow", isFinal: false)
        t.update("buy milk", isFinal: false)
        XCTAssertEqual(t.segments, [.init(text: "Call the plumber tomorrow", isFinal: true), .init(text: "buy milk", isFinal: false)])
        t.update("buy milk and eggs", isFinal: true)
        XCTAssertEqual(t.finished, ["Call the plumber tomorrow", "buy milk and eggs"])
        XCTAssertEqual(t.text, "Call the plumber tomorrow buy milk and eggs")
    }

    func testStartTimesCatchALongerFreshTranscription() {
        var t = Transcript()
        t.update("call mum", start: 0.4, isFinal: false)
        t.update("buy milk and eggs on the way home", start: 3.2, isFinal: false)
        XCTAssertEqual(t.finished, ["call mum"])
        XCTAssertEqual(t.current, "buy milk and eggs on the way home")
    }

    func testRevisionsAreNotFreshStarts() {
        var t = Transcript()
        t.update("I scream", start: 0.2, isFinal: false)
        t.update("ice cream", start: 0.2, isFinal: false)
        XCTAssertEqual(t.finished, [])
        XCTAssertEqual(t.current, "ice cream")
        t.update("ice cream tomorrow please", isFinal: false)
        t.update("ice cream tomorrow", isFinal: false)
        XCTAssertEqual(t.finished, [])
        XCTAssertEqual(t.current, "ice cream tomorrow")
    }

    func testAnEmptyFinalResultKeepsWhatWasHeard() {
        var t = Transcript()
        t.update("call mum", isFinal: false)
        t.update("", isFinal: true)
        XCTAssertEqual(t.finished, ["call mum"])
        XCTAssertEqual(t.current, "")
    }

    func testFinishWithoutAFinalResult() {
        var t = Transcript()
        t.update("call mum", isFinal: false)
        t.finish()
        XCTAssertEqual(t.segments, [.init(text: "call mum", isFinal: true)])
        t.finish()
        XCTAssertEqual(t.finished, ["call mum"])
    }
}
