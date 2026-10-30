// swift-tools-version:5.9
import PackageDescription

// The apps' logic that needs no UI: which server, which pages stay in the window, the app's own links, what the page
// may ask for, colours and speech transcripts. Foundation only, so `swift test` runs it anywhere.
let package = Package(
    name: "LifeIsShortCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LifeIsShortCore", targets: ["LifeIsShortCore"])],
    targets: [
        .target(name: "LifeIsShortCore"),
        .testTarget(name: "LifeIsShortCoreTests", dependencies: ["LifeIsShortCore"]),
    ]
)
