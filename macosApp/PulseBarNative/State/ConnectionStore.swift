import Foundation
@preconcurrency import PulseBarShared

@MainActor
final class ConnectionStore: ObservableObject {
    let endpointId: String

    @Published private(set) var state: PulseBarConnectionState?


    private let bridge: PulseBarBridge
    private var subscribed = false
    init(endpointId: String, bridge: PulseBarBridge) {
        self.endpointId = endpointId
        self.bridge = bridge
    }

    var manuallyDisconnected: Bool {
        false
    }

    var isConnecting: Bool {
        state?.connectionState == .CONNECTING || state?.connectionState == .RECONNECTING
    }

    func start() {
        guard !subscribed else { return }
        subscribed = true
    }

    func stop() {
        subscribed = false
        state = nil
    }

    func applyState(_ state: PulseBarConnectionState) {
        self.state = state
    }

    func addEndpoint() {
        // endpoint
    }

    func removeEndpoint() {
        bridge.emitNativeEvent(event: RemoveEndpointCommand(endpointId: endpointId))
    }

    func setEndpointEnabled(enabled: Bool) {
        let event: any NativeDeviceEvent = enabled
            ? EnableEndpointCommand(endpointId: endpointId)
            : DisableEndpointCommand(endpointId: endpointId)
        bridge.emitNativeEvent(event: event)
    }

    func disconnectEndpoint() {
        bridge.emitNativeEvent(event: DisconnectEndpointCommand(endpointId: endpointId))
    }

    func connectEndpoint() {
        bridge.emitNativeEvent(event: ConnectEndpointCommand(endpointId: endpointId))
    }
}
