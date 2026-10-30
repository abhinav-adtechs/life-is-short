import XCTest
@testable import LifeIsShortCore

final class ServerAddressTests: XCTestCase {
    private func origin(_ input: String) -> String? { ServerAddress.normalize(input)?.absoluteString }

    func testBareHostsBecomeHTTPSOrigins() {
        XCTAssertEqual(origin("life-is-short.vercel.app"), "https://life-is-short.vercel.app")
        XCTAssertEqual(origin("  Life-Is-Short.Vercel.App \n"), "https://life-is-short.vercel.app")
        XCTAssertEqual(origin("example.com/app/"), "https://example.com")
    }

    func testFullAddressesKeepOnlyTheOrigin() {
        XCTAssertEqual(origin("https://example.com/app#settings"), "https://example.com")
        XCTAssertEqual(origin("HTTPS://EXAMPLE.COM"), "https://example.com")
        XCTAssertEqual(origin("https://example.com:443/app"), "https://example.com")
        XCTAssertEqual(origin("https://example.com:8443"), "https://example.com:8443")
    }

    func testPlainHTTPOnlyStaysPlainOnTheLocalNetwork() {
        XCTAssertEqual(origin("http://example.com"), "https://example.com")
        XCTAssertEqual(origin("localhost:3000"), "http://localhost:3000")
        XCTAssertEqual(origin("localhost:3000/app"), "http://localhost:3000")
        XCTAssertEqual(origin("http://192.168.1.20:3000"), "http://192.168.1.20:3000")
        XCTAssertEqual(origin("10.0.0.5"), "http://10.0.0.5")
        XCTAssertEqual(origin("mylaptop.local:3000"), "http://mylaptop.local:3000")
        XCTAssertEqual(origin("https://localhost:3000"), "https://localhost:3000")
    }

    func testRejectsWhatCantBeAServer() {
        XCTAssertNil(origin(""))
        XCTAssertNil(origin("   "))
        XCTAssertNil(origin("exa mple.com"))
        XCTAssertNil(origin("ftp://example.com"))
        XCTAssertNil(origin("https://"))
        XCTAssertNil(origin("https://user:pw@example.com"))
        XCTAssertNil(origin("https://exa_mple.com"))
        XCTAssertNil(origin("javascript:alert(1)"))
    }

    func testLocalHosts() {
        for host in ["localhost", "LOCALHOST", "app.localhost", "mac.local", "printer", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.0.10", "169.254.1.1"] {
            XCTAssertTrue(ServerAddress.isLocal(host: host), host)
        }
        for host in ["example.com", "8.8.8.8", "172.32.0.1", "10.20.30.40.nip.io", "192.169.0.1", "300.1.1.1", ""] {
            XCTAssertFalse(ServerAddress.isLocal(host: host), host)
        }
    }

    func testDisplay() {
        XCTAssertEqual(ServerAddress.display(URL(string: "https://example.com")!), "example.com")
        XCTAssertEqual(ServerAddress.display(URL(string: "http://localhost:3000")!), "localhost:3000")
    }

    func testSameOrigin() {
        let a = URL(string: "https://A.example.com/app")!
        XCTAssertTrue(a.isSameOrigin(as: URL(string: "https://a.example.com:443/privacy")!))
        XCTAssertFalse(a.isSameOrigin(as: URL(string: "http://a.example.com/app")!))
        XCTAssertFalse(a.isSameOrigin(as: URL(string: "https://a.example.com:8443/app")!))
        XCTAssertFalse(a.isSameOrigin(as: URL(string: "https://example.com/app")!))
        XCTAssertFalse(a.isSameOrigin(as: URL(string: "about:blank")!))
    }
}
