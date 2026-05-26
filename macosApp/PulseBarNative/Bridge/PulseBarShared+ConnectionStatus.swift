import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

extension PulseBarStreamConnectionState {
    var color: Color {
        switch self {
        case .CONNECTED: return .green
        case .CONNECTING, .RECONNECTING, .STOPPING: return .yellow
        case .FAILED: return .red
        case .IDLE, .STOPPED: return .gray
        }
    }

    var title: String {
        switch self {
        case .IDLE: return "idle"
        case .CONNECTING: return "connecting"
        case .CONNECTED: return "connected"
        case .RECONNECTING: return "reconnecting"
        case .STOPPING: return "stopping"
        case .STOPPED: return "stopped"
        case .FAILED: return "failed"
        }
    }

    var isConnected: Bool {
        self == .CONNECTED
    }
}
