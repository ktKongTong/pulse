import Foundation
@preconcurrency import PulseBarShared

typealias AppUsageItem = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.AppUsageItem
typealias EndpointConfig = ExportedKotlinPackages.io.github.kt.pulsebar.model.EndpointConfig
typealias FocusState = ExportedKotlinPackages.io.github.kt.pulsebar.model.FocusState
typealias Media = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.Media
typealias MediaFlowState = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.MediaFlowState
typealias ConnectCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ConnectCommand
typealias DisconnectCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.DisconnectCommand
typealias SetEndpointEnabledCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.SetEndpointEnabledCommand
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
typealias PulseBarConnectionStatus = ExportedKotlinPackages.io.github.kt.pulsebar.ws.connection.ConnectionStatus
typealias PulsePlaybackStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.PlaybackStatus
typealias PulseStreamCaptureStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamCaptureStatus
typealias PulseStreamPermission = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamPermission
typealias StreamFormat = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamFormat
typealias PulseStreamStopReason = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamStopReason
typealias RuntimeState = ExportedKotlinPackages.io.github.kt.pulsebar.model.RuntimeState
typealias ServerCommandEvent = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.ServerCommandEvent
typealias UpdateConfigCommand = ExportedKotlinPackages.io.github.kt.pulsebar.export.event.UpdateConfigCommand
typealias UsageStats = ExportedKotlinPackages.io.github.kt.pulsebar.export.ui.UsageStats
typealias SharedFormatters = ExportedKotlinPackages.io.github.kt.pulsebar.utils
