import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

extension PulseBarConnectionStatus {
    var color: Color {
        switch self {
        case .Connected: return .green
        case .Connecting, .Reconnecting, .Closing: return .yellow
        case .Failed: return .red
        case .Idle, .Offline, .Closed: return .gray
        }
    }

    var isConnected: Bool {
        self == .Connected
    }
}

extension PulseBarConnectionState {
    var connectionStatus: PulseBarConnectionStatus { connection.phase }
}
