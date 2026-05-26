import Foundation
@preconcurrency import PulseBarShared

/// Marker abstraction over the Kotlin bridge so StreamCaptureStore can share
/// the app's bridge instance without owning connection APIs directly.
protocol StreamBridge: AnyObject, Sendable {
    var hostCommands: any KotlinCoroutineSupport.KotlinTypedFlow<NativeHostCommand> { get }
    func emitNativeEvent(event: any NativeDeviceEvent)
    func submitStreamPcmBase64(chunkBase64: String)
}

extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: StreamBridge {}
