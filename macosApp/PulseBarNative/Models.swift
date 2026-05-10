import Foundation
@preconcurrency import PulseBarShared

// MARK: - Swift-only UI state
//
// The Swift layer no longer mirrors any Kotlin class. SwiftUI binds straight
// to `PulseBarSnapshot`, `PulseBarMedia`, `PulseBarUsageRow`, `PulseBarInteractionItem`,
// `PulseBarSyncState`, `PulseBarEndpointSyncState`, `PulseBarConfigDraft`,
// `PulseBarEndpointDraft`, `PulseBarLiveListenStats`. The only Swift types that
// remain are things SwiftUI navigation state or AppKit-bound values need.

enum DashboardSection: String, CaseIterable, Identifiable {
    case connection
    case reporting
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .connection: return "Connection"
        case .reporting: return "Reporting"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .connection: return "antenna.radiowaves.left.and.right"
        case .reporting: return "app.badge"
        case .settings: return "slider.horizontal.3"
        }
    }
}

/// Platform-typed Live Listen endpoint (carries a Swift `URL` that has been
/// normalized via Kotlin's shared `normalizePulseBaseUrl`). The Kotlin side
/// stores `endpointUrl: String`; this is the single adapter point between the
/// string and the Swift URL used by `URLSession` for the device-session WS.
struct LiveListenEndpointConfig: Equatable {
    let id: String
    let name: String
    let baseURL: URL
    let workspaceId: String
    let apiKey: String
}

extension LiveListenEndpointConfig {
    /// Build from the Kotlin-side `PulseBarEndpointDraft` that already comes
    /// out of `PulseBarConfigFactory.liveListenCandidateEndpoints`.
    static func fromKotlinDraft(_ endpoint: PulseBarEndpointDraft) -> LiveListenEndpointConfig? {
        let workspaceId = endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let apiKey = endpoint.apiKey
        guard !workspaceId.isEmpty, !apiKey.isEmpty else { return nil }
        // The Kotlin normalizer strips `/api/v2/presence/ingest`,
        // `/api/v1/live-listen`, `/api/v1/meta`, query, fragment, trailing
        // slash — shared with the Kotlin presence reporter so both sides
        // agree on the same base URL.
        guard let normalized = ExportedKotlinPackages.io.github.kt.pulsebar.core.platform.normalizePulseBaseUrl(raw: endpoint.endpointUrl),
              let baseURL = URL(string: normalized) else { return nil }
        return LiveListenEndpointConfig(
            id: endpoint.id,
            name: endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines),
            baseURL: baseURL,
            workspaceId: workspaceId,
            apiKey: apiKey
        )
    }
}

// MARK: - Kotlin-type extensions
//
// The Kotlin export types carry either sentinel primitives (`0L` millis,
// `-1L` sequence, `""` empty) or string representations (ISO8601 dates,
// `String?` URLs). These tiny computed properties lift those into natural
// Swift types at the read site without allocating a parallel mirror struct.

private let pulseIso8601Queue = DispatchQueue(label: "io.github.kt.pulsebar.iso8601")

nonisolated(unsafe) private let pulseIso8601Formatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

/// Parses an ISO8601 string into a Swift `Date`. We synchronize access to
/// the shared formatter by copying the string through it under a global
/// dispatch queue — the Apple formatter is not `Sendable` and Swift 6
/// strict concurrency rejects cross-actor use without a gate.
private func pulseDate(fromIso8601 value: String?) -> Date? {
    guard let value, !value.isEmpty else { return nil }
    return pulseIso8601Queue.sync {
        if let date = pulseIso8601Formatter.date(from: value) { return date }
        // Fall back to non-fractional seconds (some server payloads drop them)
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}

// SwiftUI `ForEach` + `.tag(_:)` need these Kotlin classes to be Identifiable.
extension PulseBarUsageRow: @retroactive Identifiable {
    public var id: String { key }
}

extension PulseBarInteractionItem: @retroactive Identifiable {
    public var id: String { requestId }
}

extension PulseBarEndpointSyncState: @retroactive Identifiable {
    // `val id: String` already satisfies the protocol.
}

extension PulseBarEndpointDraft: @retroactive Identifiable {
    // `var id: String` already satisfies the protocol.
}

// Cross-actor hop for Live Listen stats observer needs Sendable markings.
extension PulseBarLiveListenStats: @retroactive @unchecked Sendable {}
extension PulseBarMedia: @retroactive @unchecked Sendable {}
extension PulseBarSnapshot: @retroactive @unchecked Sendable {}

// MARK: - Kotlin snapshot / media lifts

extension PulseBarSnapshot {
    /// ISO8601 → Date. Falls back to `Date()` to match the pre-refactor
    /// behaviour of `mapSnapshotObject` (the view code never observed a
    /// nil case anyway).
    var observedAt: Date {
        pulseDate(fromIso8601: observedAtIso8601) ?? Date()
    }
}

extension PulseBarMedia {
    var artworkURL: URL? {
        artworkUrl.flatMap(URL.init(string:))
    }

    /// `0` means "duration unknown" on the Kotlin side.
    var durationSecondsOrNil: Int? {
        let value = Int(durationSeconds)
        return value > 0 ? value : nil
    }

    var trackNumberOrNil: Int? {
        trackNumber.flatMap { $0 > 0 ? Int($0) : nil }
    }

    var discNumberOrNil: Int? {
        discNumber.flatMap { $0 > 0 ? Int($0) : nil }
    }
}

// MARK: - Kotlin interaction / sync lifts

extension PulseBarInteractionItem {
    var issuedAt: Date { pulseDate(fromIso8601: issuedAtIso8601) ?? Date() }
    var updatedAt: Date { pulseDate(fromIso8601: updatedAtIso8601) ?? Date() }
}

extension PulseBarEndpointSyncState {
    var lastAttemptAt: Date? { pulseDate(fromIso8601: lastAttemptAtIso8601) }
    var lastProbeAt: Date? { pulseDate(fromIso8601: lastProbeAtIso8601) }
    var lastSuccessAt: Date? { pulseDate(fromIso8601: lastSuccessAtIso8601) }
    var lastFailureAt: Date? { pulseDate(fromIso8601: lastFailureAtIso8601) }
    var acknowledgedAt: Date? { pulseDate(fromIso8601: acknowledgedAtIso8601) }
}

// MARK: - Kotlin Live Listen stats lifts
//
// The Kotlin `PulseBarLiveListenStats` uses sentinel primitives (`0L` for
// "never", `-1L` for "none") so Swift Export can avoid KotlinLong?. These
// helpers turn the sentinels into Swift `Date?` / numeric optionals at the
// read site.

extension PulseBarLiveListenStats {
    var lastConnectedAt: Date? { Self.dateOrNil(millis: lastConnectedAtMillis) }
    var lastDisconnectedAt: Date? { Self.dateOrNil(millis: lastDisconnectedAtMillis) }
    var nextReconnectAt: Date? { Self.dateOrNil(millis: nextReconnectAtMillis) }
    var lastSendAt: Date? { Self.dateOrNil(millis: lastSendAtMillis) }

    var sendBitrateKbpsOrNil: Double? {
        sendBitrateKbps > 0 ? sendBitrateKbps : nil
    }

    var reconnectDelaySecondsOrNil: Double? {
        reconnectDelaySeconds > 0 ? reconnectDelaySeconds : nil
    }

    var queuedFirstSequenceOrNil: Int64? {
        queuedFirstSequence >= 0 ? queuedFirstSequence : nil
    }

    var queuedLastSequenceOrNil: Int64? {
        queuedLastSequence >= 0 ? queuedLastSequence : nil
    }

    /// Parse the Kotlin enum from its string name. Going through
    /// `connectionStateName` avoids Swift Export's `__externalRCRefUnsafe`
    /// enum-getter path, which asserts at runtime when the enum is read
    /// via a class getter.
    var connectionStateParsed: PulseBarLiveListenConnectionState {
        switch connectionStateName {
        case "CONNECTING": return .CONNECTING
        case "CONNECTED": return .CONNECTED
        case "RECONNECTING": return .RECONNECTING
        case "STOPPING": return .STOPPING
        case "STOPPED": return .STOPPED
        case "FAILED": return .FAILED
        default: return .IDLE
        }
    }

    private static func dateOrNil(millis: Int64) -> Date? {
        millis > 0 ? Date(timeIntervalSince1970: TimeInterval(millis) / 1000.0) : nil
    }
}

// MARK: - Kotlin draft construction helpers
//
// Thin wrappers around `PulseBarConfigFactory` so the SwiftUI layer doesn't
// know about random-UUID generation or Kotlin-side default field values.

extension PulseBarEndpointDraft {
    static func pulseDefault(index: Int) -> PulseBarEndpointDraft {
        PulseBarConfigFactory.shared.defaultEndpoint(
            index: Int32(index),
            randomId: UUID().uuidString.lowercased()
        )
    }

    static func pulseDefaultPrimary() -> PulseBarEndpointDraft {
        PulseBarConfigFactory.shared.defaultPrimaryEndpoint(
            randomId: UUID().uuidString.lowercased()
        )
    }
}
