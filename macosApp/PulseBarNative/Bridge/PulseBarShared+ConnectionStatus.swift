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

    private var devicePhaseName: String {
        String(describing: connection.phase)
    }
}
