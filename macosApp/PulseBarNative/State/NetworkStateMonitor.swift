import Foundation
import Network

final class NetworkStateMonitor: @unchecked Sendable {
    private var monitor: NWPathMonitor?
    private let queue = DispatchQueue(label: "io.github.kt.pulsebar.native.network")
    private var started = false
    private var lastSnapshot: NetworkSnapshot?

    func start(onChange: @escaping @Sendable (NetworkSnapshot) -> Void) {
        guard !started else { return }
        started = true
        let nextMonitor = NWPathMonitor()
        monitor = nextMonitor
        nextMonitor.pathUpdateHandler = { [weak self] path in
            let snapshot = NetworkSnapshot(
                online: path.status == .satisfied,
                expensive: path.isExpensive,
                constrained: path.isConstrained
            )
            guard snapshot != self?.lastSnapshot else { return }
            self?.lastSnapshot = snapshot
            onChange(snapshot)
        }
        nextMonitor.start(queue: queue)
    }

    func stop() {
        guard started else { return }
        started = false
        monitor?.cancel()
        monitor = nil
    }
}

struct NetworkSnapshot: Equatable, Sendable {
    let online: Bool
    let expensive: Bool
    let constrained: Bool
}
