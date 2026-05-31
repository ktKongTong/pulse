import SwiftUI
@preconcurrency import PulseBarShared

struct ConnectionDetailPane: View {
    @EnvironmentObject private var monitor: MonitorStore
    @EnvironmentObject private var connectionStore: ConnectionStore
    let endpoint: EndpointConfig
    let edit: () -> Void
    let delete: () -> Void


    private var connectionState: PulseBarConnectionState? {
        connectionStore.state
    }


    private var streamEndpoint: StreamEndpointPublisherStatus? {
        guard endpoint.enabled, !connectionStore.manuallyDisconnected else { return nil }
        return monitor.streamStore.endpointPublisherStats.first { $0.id == endpoint.id }
    }

    private var isStreamEndpoint: Bool {
        hasStreamConnectionFields
    }

    private var streamStats: PulseBarStreamStats? {
        streamEndpoint?.stats
    }

    private var status: PulseBarStreamConnectionState {
        if !endpoint.enabled || connectionStore.manuallyDisconnected {
            return .STOPPED
        }
        if let connectionState {
            return connectionState.connectionState
        }
        if let streamEndpoint {
            return streamEndpoint.stats.connectionState
        }
        if hasStreamConnectionFields {
            return .IDLE
        }
        return connectionStore.isConnecting ? .CONNECTING : .IDLE
    }

    private var title: String {
        let name = endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let url = endpoint.url.trimmingCharacters(in: .whitespacesAndNewlines)
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
                            ("Focus", monitor.focusState?.name ?? "No active sample"),
                            ("Media", monitor.currentMedia.map { "\($0.displayTitle) - \($0.displayArtist)" } ?? "No media"),
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
                        if status.isConnected {
                            connectionStore.disconnectEndpoint()
                        } else {
                            connectionStore.connectEndpoint()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!endpoint.enabled || connectionStore.isConnecting)

                    Button(endpoint.enabled ? "Disable" : "Enable") {
                        connectionStore.setEndpointEnabled(enabled: !endpoint.enabled)
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

            Text(endpoint.url.isEmpty ? "Endpoint identifier not configured" : endpoint.url)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    private var disconnectedReason: String {
        if let message = connectionState?.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return message
        }
        if !endpoint.enabled { return "Endpoint disabled" }
        if connectionStore.manuallyDisconnected { return "Disconnected manually" }
        return "-"
    }

    private var connectionActionTitle: String {
        status.isConnected ? "Disconnect" : "Connect"
    }

    private var deliveryDetail: String {
        if let connectionState {
            return connectionState.statusText
        }
        if !endpoint.enabled { return "Endpoint disabled" }
        return connectionStore.isConnecting ? "Connecting" : "Idle"
    }

    private var hasStreamConnectionFields: Bool {
        !endpoint.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var lastProbeText: String {
        "-"
    }

    private var lastSuccessText: String {
        if let connectionState {
            return ageText(connectionState.lastConnectedAtMillis)
        }
        return "-"
    }

    private var lastFailureText: String {
        if let connectionState {
            return ageText(connectionState.lastDisconnectedAtMillis)
        }
        return "-"
    }

    private var pendingCountText: String {
        "-"
    }

    private var streamStatusText: String {
        if connectionStore.manuallyDisconnected {
            return "Stopped manually"
        }
        if !endpoint.enabled {
            return "Endpoint disabled"
        }
        if let connectionState {
            return connectionState.statusText
        }

        let model = monitor.streamStore
        if let streamEndpoint {
            if streamEndpoint.stats.connectionState == .CONNECTED, model.isCapturing {
                return streamEndpoint.stats.isSending ? "Sending audio packets" : model.statusText
            }
            return streamEndpoint.statusText
        }
        return deliveryDetail
    }

    private var streamMessage: String? {
        if connectionStore.manuallyDisconnected {
            return "Stream stopped manually for this connection."
        }
        if !endpoint.enabled {
            return "Endpoint disabled."
        }
        if let connectionState {
            return connectionState.statusText
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
        guard endpoint.enabled, !connectionStore.manuallyDisconnected else { return false }
        return streamEndpoint?.stats.connectionState == .FAILED
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func ageText(_ epochMillis: Int64) -> String {
        guard epochMillis > 0 else { return "-" }
        let delta = max(0, (nowMillis() - epochMillis) / 1000)
        if delta < 2 { return "now" }
        if delta < 60 { return "\(delta)s ago" }
        if delta < 3600 { return "\(delta / 60)m ago" }
        if delta < 86_400 { return "\(delta / 3600)h ago" }
        return "\(delta / 86_400)d ago"
    }

}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
