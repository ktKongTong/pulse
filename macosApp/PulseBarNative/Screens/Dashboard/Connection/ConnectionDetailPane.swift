import SwiftUI
@preconcurrency import PulseBarShared

private typealias EndpointPresentation = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.EndpointPresentation
private typealias EndpointRuntimeInput = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.EndpointRuntimeInput

struct ConnectionDetailPane: View {
    @EnvironmentObject private var monitor: MonitorStore

    let endpoint: PulseBarEndpointDraft
    let edit: () -> Void
    let delete: () -> Void

    private var sync: PulseBarEndpointSyncState? {
        monitor.syncState?.endpoints.first { $0.id == endpoint.id }
    }

    private var manuallyDisconnected: Bool {
        monitor.manuallyDisconnectedEndpointIDs.contains(endpoint.id)
    }

    private var streamEndpoint: StreamEndpointPublisherStatus? {
        guard endpoint.enabled, !manuallyDisconnected else { return nil }
        return monitor.streamStore.endpointPublisherStats.first { $0.id == endpoint.id }
    }

    private var isStreamEndpoint: Bool {
        hasStreamConnectionFields
    }

    private var streamStats: PulseBarStreamStats? {
        streamEndpoint?.stats
    }

    private var status: ConnectionRuntimeStatus {
        if !endpoint.enabled || manuallyDisconnected {
            return .Disconnected
        }
        if let streamEndpoint {
            return streamEndpoint.stats.connectionStateParsed.connectionRuntimeStatus
        }
        if hasStreamConnectionFields {
            return .Disconnected
        }
        return resolveConnectionStatus(
            endpoint: endpoint,
            sync: sync,
            manuallyDisconnected: manuallyDisconnected,
            isConnecting: isConnecting
        )
    }

    private var isConnecting: Bool {
        monitor.connectingEndpointIDs.contains(endpoint.id)
    }

    private var title: String {
        let name = endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let url = endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        return url.isEmpty ? "Untitled endpoint" : url
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header

                VStack(alignment: .leading, spacing: 22) {
                    DetailSection("Connection Status") {
                        KeyValueGrid(rows: [
                            ("Status", status.title),
                            ("Enabled", endpoint.enabled ? "Enabled" : "Disabled"),
                            ("Reason", disconnectedReason),
                            ("Last probe", lastProbeText),
                            ("Last success", lastSuccessText),
                            ("Last failure", lastFailureText),
                        ])
                    }

                    DetailSection("Streaming") {
                        KeyValueGrid(rows: [
                            ("Focus", monitor.snapshot?.appName ?? "No active sample"),
                            ("Media", monitor.snapshot?.media.map { "\($0.title) - \($0.artist)" } ?? "No media"),
                            ("Delivery", deliveryDetail),
                            ("Stream", streamStatusText),
                            ("Capture source", monitor.streamStore.selectedSource?.name ?? "No source"),
                        ])

                        if let streamMessage {
                            Text(streamMessage)
                                .font(.caption)
                                .foregroundStyle(streamMessageIsError ? .red : .secondary)
                                .textSelection(.enabled)
                        }
                    }

                    DetailSection("Local Cache") {
                        KeyValueGrid(rows: [
                            ("Pending count", pendingCountText),
                        ])
                    }
                }
            }
            .padding(32)
            .frame(maxWidth: 920, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(.largeTitle.weight(.semibold))
                    HStack(spacing: 8) {
                        Circle()
                            .fill(status.color)
                            .frame(width: 9, height: 9)
                        Text(status.title)
                            .font(.headline.weight(.semibold))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .layoutPriority(2)
                        if disconnectedReason != "-" {
                            Text(disconnectedReason)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .layoutPriority(1)
                        }
                    }
                }

                Spacer()

                HStack(spacing: 10) {
                    Button(connectionActionTitle) {
                        if status == .Connected {
                            monitor.disconnectEndpoint(endpoint.id)
                        } else {
                            monitor.connectEndpoint(endpoint.id)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!endpoint.enabled || isConnecting)

                    Button(endpoint.enabled ? "Disable" : "Enable") {
                        monitor.setEndpointEnabled(endpoint.id, enabled: !endpoint.enabled)
                    }
                    .buttonStyle(.bordered)

                    Menu {
                        Button("Edit", action: edit)
                        Button("Delete", role: .destructive, action: delete)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                }
            }

            Text(endpoint.endpointUrl.isEmpty ? "Endpoint identifier not configured" : endpoint.endpointUrl)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    private var disconnectedReason: String {
        if let stats = streamStats {
            return stats.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "-"
        }
        return EndpointPresentation.shared.disconnectedReason(input: buildRuntimeInput())
    }

    private var connectionActionTitle: String {
        EndpointPresentation.shared.connectionActionTitle(input: buildRuntimeInput(), status: status)
    }

    private var deliveryDetail: String {
        if let streamEndpoint {
            return streamEndpoint.statusText
        }
        return EndpointPresentation.shared.deliveryDetail(input: buildRuntimeInput())
    }

    private var hasStreamConnectionFields: Bool {
        !endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var lastProbeText: String {
        if isStreamEndpoint { return "-" }
        return wallClock(sync?.lastProbeAtIso8601)
    }

    private var lastSuccessText: String {
        if let stats = streamStats {
            return streamLastConnectedAge(stats: stats, nowMillis: nowMillis())
        }
        return wallClock(sync?.lastSuccessAtIso8601)
    }

    private var lastFailureText: String {
        if let stats = streamStats {
            return streamLastDisconnectedAge(stats: stats, nowMillis: nowMillis())
        }
        return wallClock(sync?.lastFailureAtIso8601)
    }

    private var pendingCountText: String {
        if isStreamEndpoint { return "-" }
        return "\(sync?.pendingCount ?? monitor.syncState?.pendingCount ?? 0)"
    }

    private var streamStatusText: String {
        if manuallyDisconnected {
            return "Stopped manually"
        }
        if !endpoint.enabled {
            return "Endpoint disabled"
        }

        let model = monitor.streamStore
        if let streamEndpoint {
            if streamEndpoint.stats.connectionStateParsed == .CONNECTED, model.isCapturing {
                return streamEndpoint.stats.isSending ? "Sending audio packets" : model.statusText
            }
            return streamEndpoint.statusText
        }
        return EndpointPresentation.shared.deliveryDetail(input: buildRuntimeInput())
    }

    private var streamMessage: String? {
        if manuallyDisconnected {
            return "Stream stopped manually for this connection."
        }
        if !endpoint.enabled {
            return "Endpoint disabled."
        }
        if let streamEndpoint {
            return streamEndpoint.statusText
        }
        if !hasStreamConnectionFields {
            return nil
        }
        return "No active stream publisher for this endpoint."
    }

    private var streamMessageIsError: Bool {
        guard endpoint.enabled, !manuallyDisconnected else { return false }
        return streamEndpoint?.stats.connectionStateParsed == .FAILED
    }

    private func buildRuntimeInput() -> EndpointRuntimeInput {
        EndpointRuntimeInput(
            enabled: endpoint.enabled,
            disconnected: manuallyDisconnected,
            endpointUrl: endpoint.endpointUrl,
            isConnecting: isConnecting,
            status: sync?.status,
            lastStatus: sync?.lastStatus,
            lastErrorMessage: sync?.lastErrorMessage,
            pendingCount: Int32(sync?.pendingCount ?? 0)
        )
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func wallClock(_ iso8601: String?) -> String {
        let epochMillis = ExportedKotlinPackages.io.github.kt.pulsebar.platform.parseIso8601ToMillis(value: iso8601)
        return ExportedKotlinPackages.io.github.kt.pulsebar.platform.formatWallClockTime(epochMillis: epochMillis)
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
