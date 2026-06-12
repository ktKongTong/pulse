import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

extension PulseBarStreamConnectionState {
    var color: Color {
        switch self {
        case .CONNECTED: return .green
        case .CONNECTING, .RECONNECTING, .STOPPING: return .yellow
        case .FAILED: return .red
        case .IDLE, .OFFLINE, .STOPPED: return .gray
        }
    }

    var title: String {
        switch self {
        case .IDLE: return "idle"
        case .CONNECTING: return "connecting"
        case .CONNECTED: return "connected"
        case .RECONNECTING: return "reconnecting"
        case .OFFLINE: return "offline"
        case .STOPPING: return "stopping"
        case .STOPPED: return "stopped"
        case .FAILED: return "failed"
        }
    }

    var isConnected: Bool {
        self == .CONNECTED
    }
}

extension PulseBarConnectionState {
    var connectionState: PulseBarStreamConnectionState {
        switch devicePhaseName {
        case "Connected":
            return .CONNECTED
        case "Connecting":
            return .CONNECTING
        case "Reconnecting":
            return .RECONNECTING
        case "Offline":
            return .OFFLINE
        case "Closing":
            return .STOPPING
        case "Closed":
            return .STOPPED
        case "Failed":
            return .FAILED
        default:
            return .IDLE
        }
    }

    var isConnecting: Bool {
        connectionState == .CONNECTING || connectionState == .RECONNECTING
    }

    var statusText: String {
        if let message = lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
            return message
        }
        switch connectionState {
        case .CONNECTED:
            return "Connected"
        case .CONNECTING:
            return "Connecting"
        case .RECONNECTING:
            return "Reconnecting"
        case .OFFLINE:
            return "Offline"
        case .STOPPING:
            return "Stopping"
        case .STOPPED:
            return "Stopped"
        case .FAILED:
            return "Failed"
        case .IDLE:
            return "Idle"
        }
    }

    var lastConnectedAtMillis: Int64 {
        max(connection.common.connection.lastConnectedAtMillis ?? 0, connection.media.connection.lastConnectedAtMillis ?? 0)
    }

    var lastDisconnectedAtMillis: Int64 {
        max(connection.common.connection.lastDisconnectedAtMillis ?? 0, connection.media.connection.lastDisconnectedAtMillis ?? 0)
    }

    var lastErrorMessage: String? {
        connection.lastErrorMessage
    }

    var commonPhaseName: String {
        String(describing: connection.common.connection.phase)
    }

    private var devicePhaseName: String {
        String(describing: connection.phase)
    }
}
