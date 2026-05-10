import SwiftUI
@preconcurrency import PulseBarShared

private typealias Formatters = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.PulseBarFormatters

struct LiveListenCapturePane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    private var model: LiveListenCaptureModel { monitor.liveListenCaptureModel }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                endpointCard
                sourcePicker
                meterCard
                actionRow
                diagnosticsCard
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            monitor.prepareLiveListenCapturePane()
        }
        .onChange(of: monitor.liveListenEndpoints) { _, endpoints in
            model.updateEndpoints(endpoints)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Live Listen Capture")
                .font(.largeTitle.weight(.semibold))
            Text("Capture Spotify, Apple Music, or app audio without changing the current output device. The native app keeps one server connection per configured Settings endpoint; web listener demand controls when capture starts and stops.")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }


    private var endpointCard: some View {
        LiveListenCaptureSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label("Live Listen Endpoint", systemImage: "network")
                    .font(.headline)
                let endpoints = monitor.liveListenEndpoints
                if !endpoints.isEmpty {
                    ForEach(endpoints, id: \.id) { endpoint in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(endpoint.displayName)
                                .font(.caption.weight(.semibold))
                            Text(endpoint.baseUrl)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                            Text("Workspace: \(endpoint.workspaceId)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("Configure endpoint URLs, Workspace IDs, and API Keys in Settings > Endpoints before starting a native stream.")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private var sourcePicker: some View {
        LiveListenCaptureSurface {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Capture Source", systemImage: "speaker.wave.2.fill")
                        .font(.headline)
                    Spacer()
                    Button("Refresh") { model.refreshSources() }
                        .disabled(model.isCapturing)
                }

                Picker("Source", selection: Binding(
                    get: { model.selectedSourceId },
                    set: { model.selectedSourceId = $0 }
                )) {
                    ForEach(model.sources) { source in
                        Text(sourceLabel(source)).tag(source.id)
                    }
                }
                .pickerStyle(.menu)
                .disabled(model.isCapturing)

                if let selected = model.selectedSource {
                    HStack(spacing: 8) {
                        Text(selected.kind.rawValue.uppercased())
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(Color.accentColor.opacity(0.16)))
                        Text(selected.bundleId ?? "All app audio routed to the default output")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private var meterCard: some View {
        LiveListenCaptureSurface {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Capture Meter", systemImage: "waveform.path")
                        .font(.headline)
                    Spacer()
                    Text(model.statusText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(model.isCapturing ? .green : .secondary)
                }

                VStack(alignment: .leading, spacing: 10) {
                    MeterRow(title: "Peak", value: model.meter.peak)
                    MeterRow(title: "RMS", value: model.meter.rms)
                }

                HStack(spacing: 18) {
                    StatPill(title: "frames", value: "\(model.meter.capturedFrames)")
                    StatPill(title: "non-silent", value: "\(model.meter.nonSilentSamples)")
                    StatPill(title: "pushed", value: "\(model.publisherStats.acceptedFrames)")
                }

                HStack(spacing: 18) {
                    StatPill(title: "ws kbps", value: liveListenSendBitrateDisplay(stats: model.publisherStats))
                    StatPill(title: "chunks", value: "\(model.publisherStats.chunksSent)")
                    StatPill(title: "bytes", value: ByteCountFormatter.string(fromByteCount: Int64(model.publisherStats.bytesSent), countStyle: .binary))
                    StatPill(title: "queued frames", value: "\(model.publisherStats.bufferedFrames)")
                }

                HStack(spacing: 18) {
                    StatPill(title: "native queue", value: "\(model.publisherStats.queuedChunks)")
                    StatPill(title: "queue bytes", value: ByteCountFormatter.string(fromByteCount: Int64(model.publisherStats.queuedBytes), countStyle: .binary))
                    StatPill(title: "reconnects", value: "\(model.publisherStats.reconnectCount)")
                    StatPill(title: "dropped chunks", value: "\(model.publisherStats.droppedChunks)")
                }

                HStack(spacing: 18) {
                    StatPill(title: "last chunk", value: ByteCountFormatter.string(fromByteCount: Int64(model.publisherStats.lastChunkBytes), countStyle: .binary))
                    StatPill(title: "chunk ms", value: "\(model.publisherStats.chunkDurationMs)")
                    StatPill(title: "accepted", value: ByteCountFormatter.string(fromByteCount: Int64(model.publisherStats.acceptedBytes), countStyle: .binary))
                    StatPill(title: "dropped", value: "\(model.publisherStats.droppedFrames)")
                }

                HStack(spacing: 18) {
                    StatPill(title: "server", value: model.serverConnectionText)
                    StatPill(title: "permission", value: model.mediaStreamPermission.rawValue)
                    StatPill(title: "playback", value: model.mediaPlaybackStatus.rawValue)
                    StatPill(title: "capture", value: model.captureActivityText)
                }

                HStack(spacing: 18) {
                    StatPill(title: "next reconnect", value: model.nextReconnectText)
                    StatPill(title: "queue seq", value: liveListenQueueRange(stats: model.publisherStats))
                    StatPill(title: "last send", value: liveListenLastSendAge(stats: model.publisherStats, nowMillis: nowMillis()))
                }

                VStack(alignment: .leading, spacing: 6) {
                    DetailRow(title: "Endpoint", value: model.serverEndpointText)
                    DetailRow(title: "Audio capture permission", value: model.audioCapturePermissionStatus.rawValue)
                    DetailRow(title: "Current media", value: model.currentMediaLabel)
                    DetailRow(title: "Playback reason", value: model.mediaPlaybackReason)
                    DetailRow(title: "Connected", value: liveListenLastConnectedAge(stats: model.publisherStats, nowMillis: nowMillis()))
                    DetailRow(title: "Disconnected", value: liveListenLastDisconnectedAge(stats: model.publisherStats, nowMillis: nowMillis()))
                    DetailRow(title: "Last error", value: model.publisherStats.lastErrorMessage ?? "-")
                }

                endpointPublisherMeter

                Text(model.publisherStatusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var endpointPublisherMeter: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Endpoint Publishers")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if model.endpointPublisherStats.isEmpty {
                Text("No configured Live Listen endpoints.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.endpointPublisherStats) { endpoint in
                    EndpointPublisherMeterRow(endpoint: endpoint)
                }
            }
        }
    }

    private var actionRow: some View {
        LiveListenCaptureSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label("Automatic Stream Control", systemImage: "bolt.horizontal.circle")
                    .font(.headline)
                Text("串流由 Web 侧一起听请求触发，通过 server device control 自动 start/stop。这里是观测面板，不再提供手动 Start。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Toggle("Allow Media Stream", isOn: Binding(
                    get: { model.mediaStreamPermission == .allow },
                    set: { model.setMediaStreamAllowed($0) }
                ))
                .toggleStyle(.switch)
                HStack(spacing: 12) {
                    Button("Refresh Sources") { monitor.prepareLiveListenCapturePane() }
                        .disabled(model.isCapturing)
                    Button {
                        model.startCaptureOnly(seconds: 10)
                    } label: {
                        Label("Capture 10s Sample", systemImage: "record.circle")
                    }
                    .disabled(model.isCapturing)
                    Button {
                        model.reconnectServer()
                    } label: {
                        Label("Reconnect Server", systemImage: "arrow.clockwise")
                    }
                    .disabled(!model.canReconnectServer)
                    Button {
                        monitor.stopDebugNativeLiveListenStream()
                    } label: {
                        Label("Stop Capture", systemImage: "stop.fill")
                    }
                    .disabled(!model.isCapturing)
                    if let url = model.lastSampleURL {
                        Button("Reveal Sample") {
                            NSWorkspace.shared.activateFileViewerSelecting([url])
                        }
                    }
                }
            }
        }
    }

    private var diagnosticsCard: some View {
        LiveListenCaptureSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label("Diagnostics", systemImage: "stethoscope")
                    .font(.headline)
                Text("If capture fails, grant PulseBarNative access in System Settings > Privacy & Security > Screen & System Audio Recording.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let error = model.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
                if let url = model.lastSampleURL {
                    Text(url.path)
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private func formatOptional(_ value: Double?) -> String {
        Formatters.shared.formatOptionalDouble(value: value)
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func sourceLabel(_ source: LiveListenCaptureSource) -> String {
        switch source.kind {
        case .system:
            return source.name
        case .application:
            return "\(source.name) — app"
        }
    }
}

private struct MeterRow: View {
    let title: String
    let value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title)
                    .font(.caption.weight(.medium))
                Spacer()
                Text(value.formatted(.number.precision(.fractionLength(4))))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.16))
                    Capsule().fill(Color.accentColor.opacity(0.82))
                        .frame(width: max(4, proxy.size.width * min(1, value)))
                }
            }
            .frame(height: 8)
        }
    }
}

private struct DetailRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 8) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 86, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

private struct StatPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.callout.monospacedDigit())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.10)))
    }
}

private struct EndpointPublisherMeterRow: View {
    let endpoint: LiveListenEndpointPublisherStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(endpoint.name)
                    .font(.caption.weight(.semibold))
                Spacer()
                Text(endpoint.stats.connectionStateName)
                    .font(.caption.monospaced())
                    .foregroundStyle(connectionColor)
            }
            Text(endpoint.endpointURL)
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            HStack(spacing: 10) {
                MiniStat(title: "kbps", value: liveListenSendBitrateDisplay(stats: endpoint.stats))
                MiniStat(title: "chunks", value: "\(endpoint.stats.chunksSent)")
                MiniStat(title: "bytes", value: ByteCountFormatter.string(fromByteCount: Int64(endpoint.stats.bytesSent), countStyle: .binary))
                MiniStat(title: "chunk ms", value: "\(endpoint.stats.chunkDurationMs)")
                MiniStat(title: "queue", value: "\(endpoint.stats.queuedChunks)")
                MiniStat(title: "seq", value: liveListenQueueRange(stats: endpoint.stats))
                MiniStat(title: "last", value: liveListenLastSendAge(stats: endpoint.stats, nowMillis: Int64(Date().timeIntervalSince1970 * 1000.0)))
            }
            if let error = endpoint.stats.lastErrorMessage, !error.isEmpty {
                Text(error)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.red)
                    .lineLimit(2)
                    .textSelection(.enabled)
            } else {
                Text(endpoint.statusText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.08)))
    }

    private var connectionColor: Color {
        switch endpoint.stats.connectionStateParsed {
        case .CONNECTED:
            return .green
        case .CONNECTING, .RECONNECTING:
            return .orange
        case .FAILED:
            return .red
        default:
            return .secondary
        }
    }
}

private struct MiniStat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption.monospacedDigit())
        }
        .frame(minWidth: 54, alignment: .leading)
    }
}

private struct LiveListenCaptureSurface<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.secondary.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.secondary.opacity(0.12), lineWidth: 1)
            )
    }
}
