import Foundation
@preconcurrency import PulseBarShared

typealias AppUsageItem = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.AppUsageItem
typealias ConnectEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ConnectEndpointCommand
typealias DisableEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.DisableEndpointCommand
typealias DisconnectEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.DisconnectEndpointCommand
typealias EnableEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.EnableEndpointCommand
typealias EndpointConfig = ExportedKotlinPackages.io.github.kt.pulsebar.model.EndpointConfig
typealias FocusState = ExportedKotlinPackages.io.github.kt.pulsebar.model.FocusState
typealias FocusConfig = ExportedKotlinPackages.io.github.kt.pulsebar.model.FocusConfig
typealias Media = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.Media
typealias MediaFlowState = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.MediaFlowState
typealias NativeDeviceEvent = ExportedKotlinPackages.io.github.kt.pulsebar.evt.AppEvent
typealias NativeFrontmostAppChanged = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
typealias NativeMediaStateChanged = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeMediaStateChanged
typealias NativeMediaStreamStopped = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeMediaStreamStopped
typealias NativeNetworkChanged = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeNetworkChanged
typealias NativeRequestedCommandEvent = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeRequestedCommandEvent
typealias NativeStoppedCommandEvent = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeStoppedCommandEvent
typealias NativeStreamPcmChunk = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.NativeStreamPcmChunk
typealias PlayerPlaybackCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.PlayerPlaybackCommand
typealias PulseBarConfig = ExportedKotlinPackages.io.github.kt.pulsebar.model.PulseConfig
typealias PulseBarConnectionState = ExportedKotlinPackages.io.github.kt.pulsebar.model.connection.ConnectionState
typealias PulseBarStreamStats = ExportedKotlinPackages.io.github.kt.pulsebar.ws.media.MediaRuntimeState
typealias StreamFormat = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamFormat
typealias PulseStreamStopReason = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamStopReason
typealias ReconnectEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ReconnectEndpointCommand
typealias RemoveEndpointCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.RemoveEndpointCommand
typealias RuntimeState = ExportedKotlinPackages.io.github.kt.pulsebar.model.RuntimeState
typealias ServerCommandEvent = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ServerCommandEvent
typealias UpdateConfigCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.UpdateConfigCommand
typealias UsageStats = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.UsageStats

private func pulseNowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000.0)
}

extension ConnectEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension EnableEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension DisableEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension DisconnectEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension ReconnectEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension RemoveEndpointCommand {
    convenience init(endpointId: String) {
        self.init(endpointId: endpointId, sentAt: pulseNowMillis())
    }
}

extension UpdateConfigCommand {
    convenience init(config: PulseBarConfig) {
        self.init(config: config, sentAt: pulseNowMillis())
    }
}

extension NativeStreamPcmChunk {
    convenience init(chunkBase64: String, mediaStartPositionMs: Int64) {
        self.init(chunkBase64: chunkBase64, mediaStartPositionMs: mediaStartPositionMs, observedAtMillis: pulseNowMillis())
    }
}

extension NativeMediaStreamStopped {
    convenience init(reason: PulseStreamStopReason) {
        self.init(reason: reason, observedAtMillis: pulseNowMillis())
    }
}

extension NativeNetworkChanged {
    convenience init(online: Bool, expensive: Bool, constrained: Bool) {
        self.init(
            online: online,
            expensive: expensive,
            constrained: constrained,
            observedAtMillis: pulseNowMillis()
        )
    }
}

enum PulseBarStreamConnectionState {
    case IDLE
    case CONNECTING
    case CONNECTED
    case RECONNECTING
    case OFFLINE
    case STOPPING
    case STOPPED
    case FAILED
}

extension PulseBarConfig {
    convenience init(
        endpoints: [EndpointConfig],
        idleThresholdSeconds: Int32,
        changeStabilityMillis: Int32
    ) {
        self.init(
            endpoints: endpoints,
            commonConfig: FocusConfig(
                idleThresholdSeconds: idleThresholdSeconds,
                changeStabilityMillis: changeStabilityMillis
            )
        )
    }

    var idleThresholdSeconds: Int32 {
        commonConfig.idleThresholdSeconds
    }

    var changeStabilityMillis: Int32 {
        commonConfig.changeStabilityMillis
    }
}

final class PulseBarStreamStatsFactory: @unchecked Sendable {
    static let shared = PulseBarStreamStatsFactory()

    private init() {}

    func idle() -> PulseBarStreamStats {
        PulseBarStreamStats(
            deviceSessionId: nil,
            streamPermission: .ALLOW,
            playbackStatus: .PAUSED,
            captureStatus: .IDLE,
            currentMedia: nil,
            activeStreamId: nil,
            activeGeneration: nil,
            captureRequested: false,
            sampleRate: 0,
            channels: 0,
            chunkDurationMs: 0,
            chunkBytes: 0,
            acceptedFrames: 0,
            acceptedBytes: 0,
            droppedFrames: 0,
            droppedChunks: 0,
            bufferedFrames: 0,
            bufferedBytes: 0,
            queuedChunks: 0,
            queuedBytes: 0,
            queuedFirstSequence: nil,
            queuedLastSequence: nil,
            maxQueuedChunks: 0,
            isSending: false,
            chunksSent: 0,
            bytesSent: 0,
            sendBitrateKbps: nil,
            lastSequence: 0,
            lastChunkBytes: 0,
            lastChunkSentAtMillis: nil,
            serverCommandsReceived: 0,
            streamRequestCount: 0,
            streamResumeCount: 0,
            streamStopCount: 0,
            lastRejectedReason: nil,
            lastStopReason: nil
        )
    }
}

extension PulseBarStreamStats {
    var connectionState: PulseBarStreamConnectionState {
        if captureRequested || activeStreamId != nil || isSending {
            return .CONNECTED
        }
        return .IDLE
    }

    var nextReconnectAtMillis: Int64 {
        0
    }

    var statusText: String {
        if isSending { return "Sending audio packets" }
        if captureRequested { return "Capture requested" }
        return "Publisher idle"
    }
}
