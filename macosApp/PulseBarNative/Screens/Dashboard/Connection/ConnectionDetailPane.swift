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

    private var liveListenEndpoint: LiveListenEndpointPublisherStatus? {
        monitor.liveListenStore.endpointPublisherStats.first { $0.id == endpoint.id }
    }

    private var status: ConnectionRuntimeStatus {
        resolveConnectionStatus(
            endpoint: endpoint,
            sync: sync,
            manuallyDisconnected: endpoint.disconnected,
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
                            ("Last probe", sync.map(endpointLastProbeWallClock) ?? "-"),
                            ("Last success", sync.map(endpointLastSuccessWallClock) ?? "-"),
                            ("Last failure", sync.map(endpointLastFailureWallClock) ?? "-"),
                        ])
                    }

                    DetailSection("Streaming") {
                        KeyValueGrid(rows: [
                            ("Focus", monitor.snapshot?.appName ?? "No active sample"),
                            ("Media", monitor.snapshot?.media.map { "\($0.title) - \($0.artist)" } ?? "No media"),
                            ("Delivery", deliveryDetail),
                            ("Live Listen", liveListenStatusText),
                            ("Capture source", monitor.liveListenStore.selectedSource?.name ?? "No source"),
                        ])

                        if endpoint.disconnected {
                            Text("Live Listen stopped manually for this connection.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let error = monitor.liveListenStore.errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
                           !error.isEmpty {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        } else if let liveListenEndpoint {
                            Text(liveListenEndpoint.statusText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(monitor.liveListenStore.publisherStatusText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    DetailSection("Local Cache") {
                        KeyValueGrid(rows: [
                            ("Pending count", "\(sync?.pendingCount ?? monitor.syncState?.pendingCount ?? 0)"),
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
        EndpointPresentation.shared.disconnectedReason(input: buildRuntimeInput())
    }

    private var connectionActionTitle: String {
        EndpointPresentation.shared.connectionActionTitle(input: buildRuntimeInput(), status: status)
    }

    private var deliveryDetail: String {
        EndpointPresentation.shared.deliveryDetail(input: buildRuntimeInput())
    }

    private var liveListenStatusText: String {
        if endpoint.disconnected {
            return "Stopped manually"
        }
        if !endpoint.enabled {
            return "Endpoint disabled"
        }

        let model = monitor.liveListenStore
        if let liveListenEndpoint {
            if liveListenEndpoint.stats.connectionStateParsed == .CONNECTED, model.isCapturing {
                return liveListenEndpoint.stats.isSending ? "Sending audio packets" : model.statusText
            }
            return liveListenEndpoint.statusText
        }
        if let error = model.errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines), !error.isEmpty {
            return error
        }
        return model.publisherStatusText
    }

    private func buildRuntimeInput() -> EndpointRuntimeInput {
        EndpointRuntimeInput(
            enabled: endpoint.enabled,
            disconnected: endpoint.disconnected,
            endpointUrl: endpoint.endpointUrl,
            isConnecting: isConnecting,
            status: sync?.status,
            lastStatus: sync?.lastStatus,
            lastErrorMessage: sync?.lastErrorMessage,
            pendingCount: Int32(sync?.pendingCount ?? 0)
        )
    }
}
