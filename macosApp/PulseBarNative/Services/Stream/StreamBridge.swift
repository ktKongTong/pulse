import Foundation
@preconcurrency import PulseBarShared

/// Marker abstraction over the Kotlin bridge so StreamCaptureStore can share
/// the app's bridge instance without owning connection APIs directly.
protocol StreamBridge: AnyObject, Sendable {
}

extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: StreamBridge {}
