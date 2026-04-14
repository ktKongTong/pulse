import SwiftUI

struct NativeSettingsView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        SettingsEditorContent(showTitle: true)
            .environmentObject(monitor)
    }
}

struct PulseBarDashboardView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                DashboardSidebarHeader()
                    .environmentObject(monitor)

                List(
                    DashboardSection.allCases,
                    selection: Binding(
                        get: { monitor.dashboardSelection },
                        set: { monitor.dashboardSelection = $0 ?? .dashboard }
                    )
                ) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
                .listStyle(.sidebar)
            }
            .padding(.horizontal, 12)
            .padding(.top, 18)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250)
        } detail: {
            Group {
                switch monitor.dashboardSelection {
                case .dashboard:
                    DashboardOverviewPane()
                case .activity:
                    DashboardActivityPane()
                case .sync:
                    DashboardSyncPane()
                case .settings:
                    SettingsEditorContent(showTitle: false)
                }
            }
            .environmentObject(monitor)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
        }
    }
}

private struct DashboardSidebarHeader: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Text("PulseBar")
                    .font(.title.weight(.bold))
                Spacer()
                Circle()
                    .fill(monitor.isPaused ? Color.orange : Color.green)
                    .frame(width: 8, height: 8)
            }

            Text("Native monitor dashboard")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color.secondary.opacity(0.08))
        )
    }
}

private struct DashboardOverviewPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DashboardPageHeader(
                    title: "Dashboard",
                    subtitle: "Live focus, media, and usage without the tray constraints."
                ) {
                    HStack(spacing: 10) {
                        DashboardBadge(title: "Today", value: durationString(monitor.todayTotalSeconds))
                        DashboardBadge(
                            title: "Status",
                            value: monitor.isPaused ? "Paused" : "Monitoring"
                        )
                    }
                }

                if let snapshot = monitor.snapshot {
                    PulseBarCurrentAppCard(snapshot: snapshot)
                }

                if let media = monitor.snapshot?.media {
                    DashboardSectionSurface {
                        PulseBarMediaCard(
                            media: media,
                            onPrevious: { monitor.mediaCommand(.PREVIOUS) },
                            onTogglePlayPause: { monitor.mediaCommand(.TOGGLE_PLAY_PAUSE) },
                            onNext: { monitor.mediaCommand(.NEXT) },
                            onSeek: { target in
                                monitor.seekMedia(to: target)
                            }
                        )
                    }
                }

                DashboardSectionSurface {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            Text("Interactions")
                                .font(.title3.weight(.bold))
                            Spacer()
                            Text("\(monitor.interactionPendingCount) pending")
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }

                        if monitor.interactionItems.isEmpty {
                            Text("No pending web recommendations.")
                                .foregroundStyle(.secondary)
                        } else {
                            VStack(spacing: 12) {
                                ForEach(monitor.interactionItems) { item in
                                    InteractionRow(item: item) {
                                        monitor.acceptInteraction(item.requestId)
                                    } onDismiss: {
                                        monitor.dismissInteraction(item.requestId)
                                    }
                                }
                            }
                        }
                    }
                }

                DashboardSectionSurface {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            Text("Today")
                                .font(.title3.weight(.bold))
                            Spacer()
                            Text(durationString(monitor.todayTotalSeconds))
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }

                        VStack(spacing: 14) {
                            ForEach(Array(monitor.todayStats.prefix(10))) { row in
                                DashboardUsageRow(row: row, totalSeconds: monitor.todayTotalSeconds)
                            }
                        }
                    }
                }
            }
            .padding(28)
        }
    }
}

private struct DashboardActivityPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DashboardPageHeader(
                    title: "Activity",
                    subtitle: "Detailed breakdown for the current day."
                ) {
                    Text(durationString(monitor.todayTotalSeconds))
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                if let snapshot = monitor.snapshot {
                    DashboardSectionSurface {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Current Session")
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(.secondary)
                            PulseBarCurrentAppCard(snapshot: snapshot)
                        }
                    }
                }

                DashboardSectionSurface {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Today Breakdown")
                            .font(.title3.weight(.bold))

                        VStack(spacing: 14) {
                            ForEach(monitor.todayStats) { row in
                                DashboardUsageRow(row: row, totalSeconds: monitor.todayTotalSeconds)
                            }
                        }
                    }
                }
            }
            .padding(28)
        }
    }
}

private struct DashboardSyncPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    private let columns = [
        GridItem(.flexible(), spacing: 18, alignment: .top),
        GridItem(.flexible(), spacing: 18, alignment: .top)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DashboardPageHeader(
                    title: "Sync",
                    subtitle: "Transport and sampling settings that affect delivery."
                )

                LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                    DashboardSectionSurface {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Endpoint")
                                .font(.headline.weight(.semibold))
                            DashboardKeyValueRow(key: "Enabled", value: monitor.settingsDraft.endpointEnabled ? "Yes" : "No")
                            DashboardKeyValueRow(key: "Transport", value: monitor.settingsDraft.transport.title)
                            DashboardKeyValueRow(
                                key: "URL",
                                value: monitor.settingsDraft.endpointUrl.isEmpty ? "Not configured" : monitor.settingsDraft.endpointUrl
                            )
                            DashboardKeyValueRow(key: "Batch", value: "\(monitor.settingsDraft.batchWindowSeconds)s")
                        }
                    }

                    DashboardSectionSurface {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Sampling")
                                .font(.headline.weight(.semibold))
                            DashboardKeyValueRow(key: "Idle", value: "\(monitor.settingsDraft.idleThresholdSeconds)s")
                            DashboardKeyValueRow(key: "Stability", value: "\(monitor.settingsDraft.changeStabilityMillis)ms")
                            DashboardKeyValueRow(key: "Heartbeat", value: "\(monitor.settingsDraft.heartbeatSeconds)s")
                            DashboardKeyValueRow(key: "App", value: "\(monitor.settingsDraft.appPollingMillis)ms")
                            DashboardKeyValueRow(key: "Page", value: "\(monitor.settingsDraft.pagePollingMillis)ms")
                            DashboardKeyValueRow(key: "Media", value: "\(monitor.settingsDraft.mediaPollingMillis)ms")
                        }
                    }
                }
            }
            .padding(28)
        }
    }
}

private struct SettingsEditorContent: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @State private var saved = false

    let showTitle: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DashboardPageHeader(
                    title: showTitle ? "PulseBar Settings" : "Settings",
                    subtitle: "Monitoring, endpoint delivery, and sampling controls."
                ) {
                    HStack(spacing: 12) {
                        if saved {
                            Text("Saved")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
                        Button("Save Changes") {
                            monitor.saveConfig()
                            saved = true
                        }
                        .buttonStyle(.borderedProminent)
                        }
                }

                VStack(alignment: .leading, spacing: 18) {
                    SettingsCard(title: "Runtime", subtitle: "Current app and monitor behavior.") {
                        VStack(alignment: .leading, spacing: 14) {
                            if let snapshot = monitor.snapshot {
                                PulseBarCurrentAppCard(snapshot: snapshot)
                            }

                            ToggleRow(
                                title: "Pause monitoring",
                                subtitle: "Stops sampling and endpoint delivery until resumed.",
                                isOn: Binding(
                                    get: { monitor.isPaused },
                                    set: { _ in
                                        monitor.togglePaused()
                                        saved = false
                                    }
                                )
                            )
                        }
                    }

                    SettingsCard(title: "Endpoint Delivery", subtitle: "Configure remote sync target and auth.") {
                        VStack(alignment: .leading, spacing: 16) {
                            ToggleRow(
                                title: "Enable endpoint",
                                subtitle: "When disabled, PulseBar works locally only.",
                                isOn: draftBinding(\.endpointEnabled)
                            )

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Transport")
                                    .font(.subheadline.weight(.semibold))
                                Picker("Transport", selection: draftBinding(\.transport)) {
                                    ForEach(TransportOption.allCases) { option in
                                        Text(option.title).tag(option)
                                    }
                                }
                                .pickerStyle(.segmented)
                            }

                            LabeledField(
                                title: "Endpoint URL",
                                subtitle: "WebSocket, webhook, or batch HTTP target.",
                                text: draftBinding(\.endpointUrl)
                            )

                            LabeledSecureField(
                                title: "API Key",
                                subtitle: "Optional bearer or shared secret value.",
                                text: draftBinding(\.apiKey)
                            )

                            PresetNumericRow(
                                title: "Batch window",
                                subtitle: "How long to buffer HTTP batch events.",
                                unit: "s",
                                value: draftBinding(\.batchWindowSeconds),
                                presets: [5, 15, 30, 60]
                            )
                        }
                    }
                }

                SettingsCard(title: "Sampling", subtitle: "Tune responsiveness, heartbeats, and probe cadence.") {
                    VStack(spacing: 14) {
                        PresetNumericRow(
                            title: "Idle threshold",
                            subtitle: "Mark user away after this long without input.",
                            unit: "s",
                            value: draftBinding(\.idleThresholdSeconds),
                            presets: [60, 300, 600, 1800]
                        )
                        PresetNumericRow(
                            title: "Change stability",
                            subtitle: "Wait before committing unstable app or page changes.",
                            unit: "ms",
                            value: draftBinding(\.changeStabilityMillis),
                            presets: [300, 600, 1200, 2000]
                        )
                        PresetNumericRow(
                            title: "Heartbeat",
                            subtitle: "Push the stable state again at this interval.",
                            unit: "s",
                            value: draftBinding(\.heartbeatSeconds),
                            presets: [15, 30, 60, 120]
                        )
                        PresetNumericRow(
                            title: "App polling",
                            subtitle: "How often to probe the frontmost app.",
                            unit: "ms",
                            value: draftBinding(\.appPollingMillis),
                            presets: [250, 500, 1000, 2000]
                        )
                        PresetNumericRow(
                            title: "Page polling",
                            subtitle: "How often to refresh browser page metadata.",
                            unit: "ms",
                            value: draftBinding(\.pagePollingMillis),
                            presets: [500, 1000, 2000, 5000]
                        )
                        PresetNumericRow(
                            title: "Media polling",
                            subtitle: "How often to refresh media playback details.",
                            unit: "ms",
                            value: draftBinding(\.mediaPollingMillis),
                            presets: [500, 1000, 2000, 8000]
                        )
                    }
                }

                SettingsCard(title: "Interactions", subtitle: "Handle recommendations initiated from the web side.") {
                    VStack(alignment: .leading, spacing: 16) {
                        ToggleRow(
                            title: "Allow web interactions",
                            subtitle: "When disabled, device-side interaction requests are rejected.",
                            isOn: draftBinding(\.allowWebInteractions)
                        )

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Execution mode")
                                .font(.subheadline.weight(.semibold))
                            Picker("Execution mode", selection: draftBinding(\.interactionExecutionMode)) {
                                ForEach(InteractionExecutionMode.allCases) { option in
                                    Text(option.title).tag(option)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Recommendation action")
                                .font(.subheadline.weight(.semibold))
                            Picker("Recommendation action", selection: draftBinding(\.interactionPlaybackMode)) {
                                ForEach(InteractionPlaybackMode.allCases) { option in
                                    Text(option.title).tag(option)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        if let item = monitor.interactionItems.first {
                            InteractionRow(item: item) {
                                monitor.acceptInteraction(item.requestId)
                            } onDismiss: {
                                monitor.dismissInteraction(item.requestId)
                            }
                        } else {
                            Text("No pending requests.")
                                .foregroundStyle(.secondary)
                        }

                        monitor.interactionLastStatus.map {
                            Text($0)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(28)
        }
    }

    private func draftBinding<T>(_ keyPath: WritableKeyPath<SettingsDraft, T>) -> Binding<T> {
        Binding(
            get: { monitor.settingsDraft[keyPath: keyPath] },
            set: {
                monitor.settingsDraft[keyPath: keyPath] = $0
                saved = false
            }
        )
    }
}

private struct InteractionRow: View {
    let item: InteractionItem
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title ?? item.uri)
                        .font(.headline)
                        .lineLimit(2)
                    Text("\(item.provider) · \(item.status)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(item.uri)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(item.issuedAt.formatted(date: .omitted, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    item.targetDeviceId.map {
                        Text($0)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            HStack(spacing: 10) {
                Button("Accept", action: onAccept)
                    .buttonStyle(.borderedProminent)
                Button("Dismiss", action: onDismiss)
                    .buttonStyle(.bordered)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(Color.white.opacity(0.65))
        )
    }
}

private struct DashboardPageHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    let trailing: Trailing

    init(title: String, subtitle: String, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.largeTitle.weight(.bold))
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            trailing
        }
    }
}

private extension DashboardPageHeader where Trailing == EmptyView {
    init(title: String, subtitle: String) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = EmptyView()
    }
}

private struct DashboardSectionSurface<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color.secondary.opacity(0.08))
            )
    }
}

private struct DashboardBadge: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.semibold))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(Color.secondary.opacity(0.10))
        )
    }
}

private struct DashboardKeyValueRow: View {
    let key: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Text(key)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

private struct DashboardUsageRow: View {
    let row: UsageRow
    let totalSeconds: Int

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            AppIconView(bundleId: row.bundleId, size: 30)

            VStack(alignment: .leading, spacing: 3) {
                Text(row.label)
                    .font(.headline)
                    .lineLimit(1)
                Text(row.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(durationString(row.totalSeconds))
                    .font(.headline.monospacedDigit())
                Text(percentageString(row.totalSeconds, total: totalSeconds))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct SettingsCard<Content: View>: View {
    let title: String
    let subtitle: String
    let content: Content

    init(title: String, subtitle: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.bold))
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color.secondary.opacity(0.08))
        )
    }
}

private struct ToggleRow: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
        }
    }
}

private struct LabeledField: View {
    let title: String
    let subtitle: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

private struct LabeledSecureField: View {
    let title: String
    let subtitle: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
            SecureField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

private struct PresetNumericRow: View {
    let title: String
    let subtitle: String
    let unit: String
    @Binding var value: Int
    let presets: [Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                HStack(spacing: 8) {
                    TextField(title, value: $value, format: .number)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 92)
                        .multilineTextAlignment(.trailing)
                    Text(unit)
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 74), spacing: 8, alignment: .leading)],
                alignment: .leading,
                spacing: 8
            ) {
                ForEach(presets, id: \.self) { preset in
                    QuickValueChip(
                        label: "\(preset)\(unit)",
                        selected: value == preset
                    ) {
                        value = preset
                    }
                }
            }
        }
    }
}

private struct QuickValueChip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .foregroundStyle(selected ? .white : .primary)
        .background(
            Capsule()
                .fill(selected ? Color.accentColor : Color.white.opacity(0.7))
        )
    }
}

private func durationString(_ seconds: Int) -> String {
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60
    if h > 0 { return String(format: "%dh %02dm", h, m) }
    if m > 0 { return String(format: "%dm %02ds", m, s) }
    return "\(s)s"
}

private func percentageString(_ seconds: Int, total: Int) -> String {
    guard total > 0 else { return "0%" }
    let percent = Int((Double(seconds) / Double(total) * 100).rounded())
    return "\(percent)%"
}
