import AVFoundation
import Foundation
import LifeIsShortCore
import Speech

/// Dictation for the page's SpeechRecognition (Bridge.js): Apple's recogniser on the microphone, on the device when the
/// language allows, its words streamed back as SpeechRecognition results. One session at a time, like the browser.
@MainActor
final class SpeechBridge {
    /// Sends a speech event to the page: `start`, `result` (with segments), `error` or `end`.
    typealias Emit = (_ id: String, _ event: [String: Any]) -> Void

    private final class Session {
        let id: String
        let interim: Bool
        let recognizer: SFSpeechRecognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        let engine = AVAudioEngine()
        var task: SFSpeechRecognitionTask?
        var transcript = Transcript()
        var tapInstalled = false
        var stopping = false

        init(id: String, interim: Bool, recognizer: SFSpeechRecognizer) {
            self.id = id
            self.interim = interim
            self.recognizer = recognizer
        }
    }

    private let emit: Emit
    private var session: Session?
    /// A start waiting on the permission prompts.
    private var pending: String?
    /// The app is on screen. A backgrounded app can't start the microphone, so starts fail softly until it's back.
    var isActive = true {
        didSet { if !isActive, let s = session { stop(id: s.id) } }
    }

    init(emit: @escaping Emit) {
        self.emit = emit
    }

    /// The recogniser knows this language (or the device's), so the page gets native dictation.
    static func isSupported(language: String? = nil) -> Bool {
        recognizer(for: language) != nil
    }

    /// What SpeechRecognition.available() answers: 'available' when it can run without the network if asked to.
    func availability(lang: String?, onDevice: Bool) -> String {
        guard let r = Self.recognizer(for: lang) else { return "unavailable" }
        if onDevice { return r.supportsOnDeviceRecognition ? "available" : "unavailable" }
        return r.isAvailable ? "available" : "unavailable"
    }

    func start(id: String, lang: String?, interim: Bool, onDevice: Bool) {
        if let old = session { end(old, error: nil) }
        if let waiting = pending { pending = nil; emit(waiting, ["event": "end"]) }
        guard isActive else { return fail(id, "aborted") }
        guard Self.recognizer(for: lang) != nil else { return fail(id, "language-not-supported") }
        pending = id
        Self.requestPermissions { granted in
            Task { @MainActor in self.permissions(granted, id: id, lang: lang, interim: interim, onDevice: onDevice) }
        }
    }

    /// The answer to the microphone and speech prompts, for the start waiting on them.
    private func permissions(_ granted: Bool, id: String, lang: String?, interim: Bool, onDevice: Bool) {
        guard pending == id else { return }
        pending = nil
        guard granted else { return fail(id, "not-allowed") }
        guard isActive, let recognizer = Self.recognizer(for: lang) else { return fail(id, "aborted") }
        begin(id: id, recognizer: recognizer, interim: interim, onDevice: onDevice)
    }

    /// Stop listening, and hand over the last words once the recogniser has them.
    func stop(id: String) {
        if pending == id { pending = nil; emit(id, ["event": "end"]); return }
        guard let s = session, s.id == id, !s.stopping else { return }
        s.stopping = true
        stopAudio(s)
        s.request.endAudio()
        // The final result normally comes within a second; don't keep the page waiting if it doesn't.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard let self, let s = self.session, s.id == id else { return }
            self.end(s, error: nil)
        }
    }

    /// Stop without waiting for anything more.
    func abort(id: String) {
        if pending == id { pending = nil; emit(id, ["event": "end"]); return }
        guard let s = session, s.id == id else { return }
        session = nil
        teardown(s)
        emit(id, ["event": "end"])
    }

    // MARK: - Listening

    private func begin(id: String, recognizer: SFSpeechRecognizer, interim: Bool, onDevice: Bool) {
        let s = Session(id: id, interim: interim, recognizer: recognizer)
        s.request.shouldReportPartialResults = true
        s.request.taskHint = .dictation
        s.request.addsPunctuation = true
        if onDevice && recognizer.supportsOnDeviceRecognition { s.request.requiresOnDeviceRecognition = true }
        #if os(iOS)
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            return fail(id, "aborted")
        }
        #endif
        let input = s.engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            Self.releaseAudioSession()
            return fail(id, "audio-capture")
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tap(feeding: s.request))
        s.tapInstalled = true
        s.engine.prepare()
        do {
            try s.engine.start()
        } catch {
            teardown(s)
            return fail(id, "aborted")
        }
        session = s
        s.task = recognizer.recognitionTask(with: s.request, resultHandler: Self.results { [weak self] text, start, isFinal, failure in
            Task { @MainActor in self?.heard(id: id, text: text, start: start, isFinal: isFinal, failure: failure) }
        })
        emit(id, ["event": "start"])
    }

    private func heard(id: String, text: String?, start: Double?, isFinal: Bool, failure: Failure?) {
        guard let s = session, s.id == id else { return }
        if let text {
            s.transcript.update(text, start: start, isFinal: isFinal)
            if s.interim || isFinal { send(s) }
        }
        if isFinal || failure != nil { end(s, error: failure) }
    }

    private func send(_ s: Session) {
        let segments: [[String: Any]] = s.transcript.segments.map { ["text": $0.text, "isFinal": $0.isFinal] }
        emit(s.id, ["event": "result", "segments": segments])
    }

    /// The session's over: everything heard goes to the page as final, then any error, then `end`.
    private func end(_ s: Session, error: Failure?) {
        guard session === s else { return }
        session = nil
        let hadWords = !s.transcript.text.isEmpty
        s.transcript.finish()
        if hadWords { send(s) }
        teardown(s)
        if let error, let name = error.webName, !(name == "no-speech" && hadWords) {
            emit(s.id, ["event": "error", "error": name])
        }
        emit(s.id, ["event": "end"])
    }

    private func fail(_ id: String, _ error: String) {
        emit(id, ["event": "error", "error": error])
        emit(id, ["event": "end"])
    }

    private func stopAudio(_ s: Session) {
        if s.engine.isRunning { s.engine.stop() }
        if s.tapInstalled {
            s.engine.inputNode.removeTap(onBus: 0)
            s.tapInstalled = false
        }
    }

    private func teardown(_ s: Session) {
        stopAudio(s)
        s.request.endAudio()
        s.task?.cancel()
        s.task = nil
        Self.releaseAudioSession()
    }

    // MARK: - System callbacks, kept off the main actor: they arrive on the system's own queues.

    /// A recogniser error, reduced to what the page needs.
    struct Failure: Sendable, Equatable {
        let domain: String
        let code: Int

        /// The SpeechRecognition error name, or nil when it's only the session being cancelled.
        var webName: String? {
            if domain == "kAFAssistantErrorDomain" {
                switch code {
                case 1110: return "no-speech"
                case 203, 216, 301: return nil
                default: break
                }
            }
            return "network"
        }
    }

    private static func recognizer(for language: String?) -> SFSpeechRecognizer? {
        if let language, !language.isEmpty, let r = SFSpeechRecognizer(locale: Locale(identifier: language)) { return r }
        return SFSpeechRecognizer()
    }

    /// Speech recognition, then the microphone: both have to be allowed.
    nonisolated private static func requestPermissions(_ done: @escaping @Sendable (Bool) -> Void) {
        Self.requestSpeech { speech in Self.requestMicrophone(ifAllowed: speech, done) }
    }

    nonisolated private static func requestSpeech(_ done: @escaping @Sendable (Bool) -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: done(true)
        case .notDetermined: SFSpeechRecognizer.requestAuthorization { done($0 == .authorized) }
        default: done(false)
        }
    }

    nonisolated private static func requestMicrophone(ifAllowed allowed: Bool, _ done: @escaping @Sendable (Bool) -> Void) {
        guard allowed else { return done(false) }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: done(true)
        case .notDetermined: AVCaptureDevice.requestAccess(for: .audio) { done($0) }
        default: done(false)
        }
    }

    /// Feeds the microphone to the recogniser, on the audio thread.
    nonisolated private static func tap(feeding request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in request.append(buffer) }
    }

    /// Unpacks each recogniser result into plain values before it leaves the recogniser's queue.
    nonisolated private static func results(
        _ deliver: @escaping @Sendable (String?, Double?, Bool, Failure?) -> Void
    ) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            let failure = error.map { e -> Failure in
                let ns = e as NSError
                return Failure(domain: ns.domain, code: ns.code)
            }
            let transcription = result?.bestTranscription
            deliver(transcription?.formattedString, transcription?.segments.first?.timestamp, result?.isFinal ?? false, failure)
        }
    }

    nonisolated private static func releaseAudioSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
