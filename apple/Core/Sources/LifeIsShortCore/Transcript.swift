import Foundation

/// What's been heard in one dictation. The recogniser reports its whole transcription each time, but on the device it
/// can start a fresh one after a pause and drop what came before from its results. Those words are kept here as
/// finished segments, so nothing said is lost.
public struct Transcript: Equatable {
    public struct Segment: Equatable {
        public var text: String
        public var isFinal: Bool

        public init(text: String, isFinal: Bool) {
            self.text = text
            self.isFinal = isFinal
        }
    }

    /// Stretches of speech the recogniser has moved past.
    public private(set) var finished: [String] = []
    /// Its current transcription, still being revised.
    public private(set) var current = ""
    private var currentStart: Double?

    public init() {}

    /// A result: the recogniser's transcription so far, when its first word began (seconds into the audio, when it
    /// says), and whether it's the last one.
    public mutating func update(_ text: String, start: Double? = nil, isFinal: Bool) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.isEmpty && Self.isNewUtterance(old: current, oldStart: currentStart, new: text, newStart: start) {
            finished.append(current)
            current = ""
        }
        if isFinal {
            let last = text.isEmpty ? current : text
            if !last.isEmpty { finished.append(last) }
            current = ""
            currentStart = nil
        } else {
            current = text
            currentStart = start
        }
    }

    /// The recogniser stopped without a final result: keep what it had.
    public mutating func finish() {
        if !current.isEmpty { finished.append(current) }
        current = ""
        currentStart = nil
    }

    /// Everything heard, finished first, in the shape SpeechRecognition results take.
    public var segments: [Segment] {
        finished.map { Segment(text: $0, isFinal: true) } + (current.isEmpty ? [] : [Segment(text: current, isFinal: false)])
    }

    public var text: String {
        (finished + [current]).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The recogniser has started over rather than revised what it had: its transcription starts later in the audio,
    /// or it got shorter and no longer starts the same way.
    static func isNewUtterance(old: String, oldStart: Double?, new: String, newStart: Double?) -> Bool {
        guard !new.isEmpty else { return false }
        if let a = oldStart, let b = newStart, b > 0, b > a + 0.75 { return true }
        let before = words(old), after = words(new)
        guard after.count < before.count else { return false }
        return before.first != after.first
    }

    static func words(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "'" }).map(String.init)
    }
}
