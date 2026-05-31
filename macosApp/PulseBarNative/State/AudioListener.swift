import Foundation


final class NowPlayingEventSource: @unchecked Sendable {
    private typealias RegisterForNotifications = @convention(c) (DispatchQueue) -> Void
    private typealias GetNowPlayingInfo = @convention(c) (DispatchQueue, @escaping (CFDictionary?) -> Void) -> Void
    private typealias GetNowPlayingApplicationIsPlaying = @convention(c) (DispatchQueue, @escaping (Bool) -> Void) -> Void

    private var handle: UnsafeMutableRawPointer?
    private var registerForNotifications: RegisterForNotifications?
    private var getNowPlayingInfo: GetNowPlayingInfo?
    private var getNowPlayingApplicationIsPlaying: GetNowPlayingApplicationIsPlaying?
    private var observers: [NSObjectProtocol] = []
    private var onChange: (@Sendable (Media?) -> Void)?

    static func startupSnapshot() -> Media? {
        readPlayerFallbackSnapshot()
    }

    func start(onChange: @escaping @Sendable (Media?) -> Void) {
        guard self.onChange == nil else { return }
        self.onChange = onChange
        guard loadMediaRemote() else {
            PulseNativeLog.warn(.streamSession, "media.remote unavailable")
            return
        }

        registerForNotifications?(.main)
        observe("kMRMediaRemoteNowPlayingInfoDidChangeNotification")
        observe("kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification")
        observe("kMRMediaRemoteNowPlayingApplicationDidChangeNotification")
        observeDistributed("com.spotify.client.PlaybackStateChanged")
        observeDistributed("com.apple.Music.playerInfo")
        refresh()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.refresh()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) { [weak self] in
            self?.refresh()
        }
    }

    func stop() {
        observers.forEach { observer in
            NotificationCenter.default.removeObserver(observer)
            DistributedNotificationCenter.default().removeObserver(observer)
        }
        observers.removeAll()
        onChange = nil
    }

    private func loadMediaRemote() -> Bool {
        if getNowPlayingInfo != nil { return true }
        let path = "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote"
        guard let handle = dlopen(path, RTLD_NOW) else { return false }
        self.handle = handle

        guard
            let registerSymbol = dlsym(handle, "MRMediaRemoteRegisterForNowPlayingNotifications"),
            let infoSymbol = dlsym(handle, "MRMediaRemoteGetNowPlayingInfo"),
            let playingSymbol = dlsym(handle, "MRMediaRemoteGetNowPlayingApplicationIsPlaying")
        else {
            return false
        }

        registerForNotifications = unsafeBitCast(registerSymbol, to: RegisterForNotifications.self)
        getNowPlayingInfo = unsafeBitCast(infoSymbol, to: GetNowPlayingInfo.self)
        getNowPlayingApplicationIsPlaying = unsafeBitCast(playingSymbol, to: GetNowPlayingApplicationIsPlaying.self)
        return true
    }

    private func observe(_ name: String) {
        let observer = NotificationCenter.default.addObserver(
            forName: Notification.Name(name),
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.refresh()
        }
        observers.append(observer)
    }

    private func observeDistributed(_ name: String) {
        let observer = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name(name),
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.refresh()
        }
        observers.append(observer)
    }

    func refresh() {
        guard let getNowPlayingInfo, let getNowPlayingApplicationIsPlaying else { return }
        let queue = DispatchQueue.main
        getNowPlayingApplicationIsPlaying(queue) { [weak self] isPlaying in
            getNowPlayingInfo(queue) { info in
                let snapshot = Self.makeSnapshot(info: info, isPlaying: isPlaying)
                    ?? Self.readPlayerFallbackSnapshot()
                self?.onChange?(snapshot)
            }
        }
    }

    private static func makeSnapshot(info: CFDictionary?, isPlaying: Bool) -> Media? {
        guard let raw = info as? [String: Any], !raw.isEmpty else {
            return nil
        }
        let title = string(raw, "kMRMediaRemoteNowPlayingInfoTitle")
        let artist = string(raw, "kMRMediaRemoteNowPlayingInfoArtist")
        let album = string(raw, "kMRMediaRemoteNowPlayingInfoAlbum")
        let duration = double(raw, "kMRMediaRemoteNowPlayingInfoDuration")
        let elapsed = double(raw, "kMRMediaRemoteNowPlayingInfoElapsedTime") ?? 0
        let uniqueId = string(raw, "kMRMediaRemoteNowPlayingInfoUniqueIdentifier")
            ?? string(raw, "kMRMediaRemoteNowPlayingInfoContentItemIdentifier")
            ?? [title, artist, album].compactMap { $0 }.joined(separator: "|")

        guard title != nil || artist != nil || album != nil || !uniqueId.isEmpty else {
            return nil
        }

        return Media(
            providerId: "system",
            itemType: "track",
            trackId: uniqueId.isEmpty ? nil : uniqueId,
            uri: nil,
            linkUrl: nil,
            title: title,
            artist: artist,
            album: album,
            artworkUrl: nil,
            progressSeconds: elapsed,
            durationSeconds: duration,
            trackNumber: nil,
            discNumber: nil,
            collectionId: nil,
            collectionTitle: nil,
            collectionLinkUrl: nil,
            playbackStatus: isPlaying ? .PLAYING : .PAUSED
        )
    }

    private static func string(_ raw: [String: Any], _ key: String) -> String? {
        raw[key] as? String
    }

    private static func double(_ raw: [String: Any], _ key: String) -> Double? {
        if let value = raw[key] as? Double { return value }
        if let value = raw[key] as? NSNumber { return value.doubleValue }
        return nil
    }

    private static func readPlayerFallbackSnapshot() -> Media? {
        readSpotifySnapshot() ?? readMusicSnapshot()
    }

    func mediaCommand(_ command: PlayerPlaybackCommand) -> Bool {
        let spotifyVerb: String
        let musicVerb: String
        switch command {
        case .PREVIOUS:
            spotifyVerb = "previous track"
            musicVerb = "previous track"
        case .TOGGLE_PLAY_PAUSE:
            spotifyVerb = "playpause"
            musicVerb = "playpause"
        case .NEXT:
            spotifyVerb = "next track"
            musicVerb = "next track"
        @unknown default:
            return false
        }
        return Self.runAppleScript("""
                                   tell application id "com.spotify.client"
                                       if it is running then
                                           \(spotifyVerb)
                                           return "ok"
                                       end if
                                   end tell
                                   """) == "ok" || Self.runAppleScript("""
                                                                       tell application id "com.apple.Music"
                                                                           if it is running then
                                                                               \(musicVerb)
                                                                               return "ok"
                                                                           end if
                                                                       end tell
                                                                       """) == "ok"
    }

    func seek(to progressSeconds: Double) -> Bool {
        let normalized = String(progressSeconds)
        return Self.runAppleScript("""
                                   tell application id "com.spotify.client"
                                       if it is running then
                                           set player position to \(normalized)
                                           return "ok"
                                       end if
                                   end tell
                                   """) == "ok" || Self.runAppleScript("""
                                                                       tell application id "com.apple.Music"
                                                                           if it is running then
                                                                               set player position to \(normalized)
                                                                               return "ok"
                                                                           end if
                                                                       end tell
                                                                       """) == "ok"
    }

    private static func readSpotifySnapshot() -> Media? {
        let script = """
                     tell application id "com.spotify.client"
                         if it is running then
                             if player state is playing or player state is paused then
                                 return (player state as text) & linefeed & (player position as text) & linefeed & (id of current track) & linefeed & (spotify url of current track) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (duration of current track as text) & linefeed & (artwork url of current track)
                             end if
                         end if
                     end tell
                     """
        guard let output = runAppleScript(script) else { return nil }
        let values = paddedLines(output, count: 9)
        let rawDuration = Double(values[7].replacingOccurrences(of: ",", with: ".")) ?? 0
        let duration = rawDuration > 10_000 ? rawDuration / 1000 : rawDuration
        return Media(
            providerId: "spotify",
            itemType: "track",
            trackId: values[2].isEmpty ? nil : values[2],
            uri: values[3].isEmpty ? nil : values[3],
            linkUrl: values[3].isEmpty ? nil : values[3],
            title: values[4].isEmpty ? nil : values[4],
            artist: values[5].isEmpty ? nil : values[5],
            album: values[6].isEmpty ? nil : values[6],
            artworkUrl: values[8].isEmpty ? nil : values[8],
            progressSeconds: Double(values[1].replacingOccurrences(of: ",", with: ".")) ?? 0,
            durationSeconds: duration > 0 ? duration : nil,
            trackNumber: nil,
            discNumber: nil,
            collectionId: nil,
            collectionTitle: nil,
            collectionLinkUrl: nil,
            playbackStatus: values[0] == "playing" ? .PLAYING : .PAUSED
        )
    }

    private static func readMusicSnapshot() -> Media? {
        let script = """
                     tell application id "com.apple.Music"
                         if it is running then
                             if player state is playing or player state is paused then
                                 set trackId to ""
                                 try
                                     set trackId to (persistent ID of current track)
                                 end try
                                 return (player state as text) & linefeed & (player position as text) & linefeed & trackId & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (duration of current track as text)
                             end if
                         end if
                     end tell
                     """
        guard let output = runAppleScript(script) else { return nil }
        let values = paddedLines(output, count: 7)
        let duration = Double(values[6].replacingOccurrences(of: ",", with: "."))
        return Media(
            providerId: "apple-music",
            itemType: "track",
            trackId: values[2].isEmpty ? nil : values[2],
            uri: nil,
            linkUrl: nil,
            title: values[3].isEmpty ? nil : values[3],
            artist: values[4].isEmpty ? nil : values[4],
            album: values[5].isEmpty ? nil : values[5],
            artworkUrl: nil,
            progressSeconds: Double(values[1].replacingOccurrences(of: ",", with: ".")) ?? 0,
            durationSeconds: duration,
            trackNumber: nil,
            discNumber: nil,
            collectionId: nil,
            collectionTitle: nil,
            collectionLinkUrl: nil,
            playbackStatus: values[0] == "playing" ? .PLAYING : .PAUSED
        )
    }

    private static func runAppleScript(_ source: String) -> String? {
        let script = NSAppleScript(source: source)
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error).stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let error {
            PulseNativeLog.warn(.streamSession, "media.fallback.applescript.error \(error)")
        }
        return result?.isEmpty == false ? result : nil
    }

    private static func paddedLines(_ output: String, count: Int) -> [String] {
        let values = output.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        return values + Array(repeating: "", count: max(0, count - values.count))
    }
}
