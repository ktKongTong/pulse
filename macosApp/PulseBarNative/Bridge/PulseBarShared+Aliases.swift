import Foundation
@preconcurrency import PulseBarShared

typealias AppUsageItem = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.AppUsageItem
typealias EndpointConfig = ExportedKotlinPackages.io.github.kt.pulsebar.model.EndpointConfig
typealias FocusState = ExportedKotlinPackages.io.github.kt.pulsebar.model.FocusState
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
typealias StreamFormat = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamFormat
typealias PulseStreamStopReason = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamStopReason
typealias RuntimeState = ExportedKotlinPackages.io.github.kt.pulsebar.model.RuntimeState
typealias ServerCommandEvent = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ServerCommandEvent
typealias UpdateConfigCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.UpdateConfigCommand
typealias UsageStats = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.UsageStats

private func pulseNowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000.0)
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
