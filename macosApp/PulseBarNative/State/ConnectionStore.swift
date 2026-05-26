import Foundation
@preconcurrency import PulseBarShared

@MainActor
final class ConnectionStore: ObservableObject {
    let endpointId: String

    @Published private(set) var state: PulseBarConnectionState?


    private let bridge: PulseBarBridge
    private var observerTasks: [Task<Void, Never>] = []
    private var subscribed = false
    init(endpointId: String, bridge: PulseBarBridge) {
        self.endpointId = endpointId
        self.bridge = bridge
    }

    deinit {
        for t in observerTasks { t.cancel() }
    }

    var manuallyDisconnected: Bool {
        state?.manuallyDisconnected == true
    }

    var isConnecting: Bool {
        state?.isConnecting == true
    }

    func start() {
        guard !subscribed else { return }
        subscribed = true
        let bridge = self.bridge
        let endpointId = self.endpointId
        observerTasks.append(Task { @MainActor [weak self] in
            do {
                for try await state in bridge.connectionState(endpointId: endpointId).asAsyncSequence() {
                    self?.state = state
                }
            } catch {}
        })
    }

    func stop() {
        observerTasks.forEach { $0.cancel() }
        observerTasks.removeAll()
        subscribed = false
    }

    func addEndpoint() {
        // endpoint
    }

    func removeEndpoint() {
        bridge.emitNativeEvent(event: RemoveEndpointCommand(endpointId: endpointId, sentAt: nowMillis()))
    }

    func setEndpointEnabled(enabled: Bool) {
        let event: any NativeDeviceEvent = enabled
            ? EnableEndpointCommand(endpointId: endpointId, sentAt: nowMillis())
            : DisableEndpointCommand(endpointId: endpointId, sentAt: nowMillis())
        bridge.emitNativeEvent(event: event)
    }

    func disconnectEndpoint() {
        bridge.emitNativeEvent(event: DisconnectEndpointCommand(endpointId: endpointId, sentAt: nowMillis()))
    }

    func connectEndpoint() {
        bridge.emitNativeEvent(event: ConnectEndpointCommand(endpointId: endpointId, sentAt: nowMillis()))
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }
}
