import Foundation
@preconcurrency import PulseBarShared

// MARK: - Identifiable + Sendable conformances on Kotlin-exported types
//
// SwiftUI's `ForEach` + `.tag(_:)` need `Identifiable`. Kotlin won't emit
// the conformance for us — we add it in Swift on the existing `id` field.
//
// `@retroactive @unchecked Sendable` covers Kotlin classes we pass across
// actor boundaries (observer hops, `AsyncStream` yield). Kotlin 2.4's
// Swift Export is still finalizing Sendable inference, so we remain
// explicit. Revisit when 2.4 GA lands.

extension AppUsageItem: @retroactive Identifiable {
    public var id: String { key }
}

extension PulseBarInteractionItem: @retroactive Identifiable {
    public var id: String { requestId }
}

extension PulseBarEndpointSyncState: @retroactive Identifiable {}

extension PulseBarStreamStats: @retroactive @unchecked Sendable {}
extension Media: @retroactive @unchecked Sendable {}
extension PulseBarSnapshot: @retroactive @unchecked Sendable {}
