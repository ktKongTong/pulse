import Foundation
@preconcurrency import PulseBarShared

/// Marker abstraction over the Kotlin bridge so StreamCaptureStore can share
/// the app's bridge instance without owning connection APIs directly.
protocol StreamBridge: AnyObject, Sendable {
    var serverCommands: any KotlinCoroutineSupport.KotlinTypedFlow<any ServerCommandEvent> { get }
    func emitNativeEvent(event: any NativeDeviceEvent)
}

extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: StreamBridge {}
