import AppKit
@preconcurrency import PulseBarShared
import SwiftUI

private typealias EndpointPresentation = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.EndpointPresentation
private typealias EndpointRuntimeInput = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.EndpointRuntimeInput

struct NativeSettingsView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        GlobalSettingsPane()
            .environmentObject(monitor)
    }
}

struct PulseBarDashboardView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 0) {
                List(
                    DashboardSection.allCases,
                    selection: Binding(
                        get: { monitor.dashboardSelection },
                        set: { monitor.dashboardSelection = $0 ?? .connection }
                    )
                ) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
                .listStyle(.sidebar)

                SidebarMediaSummary(media: monitor.snapshot?.media)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 16)
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 248)
        } detail: {
            Group {
                switch monitor.dashboardSelection {
                case .connection:
                    ConnectionPane()
                case .reporting:
                    ReportingPane()
                case .settings:
                    GlobalSettingsPane()
                }
            }
            .environmentObject(monitor)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
        }
    }
}

private struct SidebarMediaSummary: View {
    let media: MediaInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            if let media {
                HStack(spacing: 10) {
                    AsyncImage(url: media.artworkURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(.quaternary)
                            .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
                    }
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 5))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(media.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(media.artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "music.note")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .foregroundStyle(.secondary)
                    Text("No media")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct ConnectionPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @State private var selectedEndpointID: String?
    @State private var editingEndpointID: String?
    @State private var deleteCandidate: EndpointSettingsDraft?

    private var endpoints: [EndpointSettingsDraft] {
        monitor.settingsDraft.endpoints
    }

    private var selectedEndpoint: EndpointSettingsDraft? {
        guard let selectedEndpointID else { return endpoints.first }
        return endpoints.first { $0.id == selectedEndpointID } ?? endpoints.first
    }

    var body: some View {
        HStack(spacing: 0) {
            connectionList
                .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            if let endpoint = selectedEndpoint {
                ConnectionDetailPane(
                    endpoint: endpoint,
                    edit: { editingEndpointID = endpoint.id },
                    delete: { deleteCandidate = endpoint }
                )
                .environmentObject(monitor)
            } else {
                EmptyConnectionPane {
                    addEndpoint()
                }
            }
        }
        .onAppear(perform: ensureSelection)
        .onChange(of: monitor.settingsDraft.endpoints) { _, _ in ensureSelection() }
        .sheet(
            isPresented: Binding(
                get: { editingEndpointID != nil },
                set: { if !$0 { editingEndpointID = nil } }
            )
        ) {
            if let editingEndpointID {
                EndpointEditorSheet(endpointID: editingEndpointID)
                    .environmentObject(monitor)
                    .frame(width: 560, height: 620)
            }
        }
        .alert(
            "Delete Connection?",
            isPresented: Binding(
                get: { deleteCandidate != nil },
                set: { if !$0 { deleteCandidate = nil } }
            )
        ) {
            Button("Delete", role: .destructive) {
                if let id = deleteCandidate?.id {
                    monitor.removeEndpoint(id)
                }
                deleteCandidate = nil
            }
            Button("Cancel", role: .cancel) {
                deleteCandidate = nil
            }
        } message: {
            Text("This removes the endpoint configuration from PulseBar.")
        }
    }

    private var connectionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Connection")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button {
                    addEndpoint()
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)

            Divider()

            List(selection: $selectedEndpointID) {
                ForEach(endpoints) { endpoint in
                    ConnectionListItem(
                        endpoint: endpoint,
                        status: connectionStatus(endpoint)
                    )
                    .tag(endpoint.id)
                }
            }
            .listStyle(.plain)
        }
    }

    private func addEndpoint() {
        monitor.addEndpoint()
        selectedEndpointID = monitor.settingsDraft.endpoints.last?.id
        editingEndpointID = selectedEndpointID
    }

    private func ensureSelection() {
        if selectedEndpointID == nil || !endpoints.contains(where: { $0.id == selectedEndpointID }) {
            selectedEndpointID = endpoints.first?.id
        }
    }

    private func connectionStatus(_ endpoint: EndpointSettingsDraft) -> ConnectionRuntimeStatus {
        if monitor.connectingEndpointIDs.contains(endpoint.id) {
            return .reconnecting
        }
        return ConnectionRuntimeStatus.resolve(
            endpoint: endpoint,
            sync: monitor.syncState?.endpoints.first { $0.id == endpoint.id },
            manuallyDisconnected: endpoint.disconnected
        )
    }
}

private struct ConnectionListItem: View {
    let endpoint: EndpointSettingsDraft
    let status: ConnectionRuntimeStatus

    private var displayName: String {
        endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var endpointLabel: String {
        endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(status.color)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(displayName.isEmpty ? (endpointLabel.isEmpty ? "Untitled endpoint" : endpointLabel) : displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if !displayName.isEmpty, !endpointLabel.isEmpty {
                    Text(endpointLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

private struct ConnectionDetailPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel

    let endpoint: EndpointSettingsDraft
    let edit: () -> Void
    let delete: () -> Void

    private var sync: EndpointSyncStatusInfo? {
        monitor.syncState?.endpoints.first { $0.id == endpoint.id }
    }

    private var liveListenEndpoint: LiveListenEndpointPublisherStatus? {
        monitor.liveListenCaptureModel.endpointPublisherStats.first { $0.id == endpoint.id }
    }

    private var status: ConnectionRuntimeStatus {
        if monitor.connectingEndpointIDs.contains(endpoint.id) {
            return .reconnecting
        }
        return ConnectionRuntimeStatus.resolve(
            endpoint: endpoint,
            sync: sync,
            manuallyDisconnected: endpoint.disconnected
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
                            ("Last probe", formatSyncDate(sync?.lastProbeAt)),
                            ("Last success", formatSyncDate(sync?.lastSuccessAt)),
                            ("Last failure", formatSyncDate(sync?.lastFailureAt)),
                        ])
                    }

                    DetailSection("Streaming") {
                        KeyValueGrid(rows: [
                            ("Focus", monitor.snapshot?.appName ?? "No active sample"),
                            ("Media", monitor.snapshot?.media.map { "\($0.title) - \($0.artist)" } ?? "No media"),
                            ("Delivery", deliveryDetail),
                            ("Live Listen", liveListenStatusText),
                            ("Capture source", monitor.liveListenCaptureModel.selectedSource?.name ?? "No source"),
                        ])

                        if endpoint.disconnected {
                            Text("Live Listen stopped manually for this connection.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let error = monitor.liveListenCaptureModel.errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
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
                            Text(monitor.liveListenCaptureModel.publisherStatusText)
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
                        if status == .connected {
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
        EndpointPresentation.shared.connectionActionTitle(input: buildRuntimeInput(), status: status.kotlinRuntime)
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

        let model = monitor.liveListenCaptureModel
        if let liveListenEndpoint {
            if liveListenEndpoint.stats.connectionState == .connected, model.isCapturing {
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

private struct EmptyConnectionPane: View {
    let add: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("No connections")
                .font(.title2.weight(.semibold))
            Button("Add Connection", action: add)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct EndpointEditorSheet: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @Environment(\.dismiss) private var dismiss

    let endpointID: String

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Edit Connection")
                .font(.title.weight(.semibold))

            VStack(alignment: .leading, spacing: 16) {
                LabeledField(title: "Name", text: endpointBinding(\.name))
                LabeledField(title: "Endpoint URL", text: endpointBinding(\.endpointUrl))
                LabeledField(title: "Workspace ID", text: endpointBinding(\.workspaceId))
                LabeledField(title: "Site ID", text: endpointBinding(\.siteId))
                LabeledSecureField(title: "API Key", text: endpointBinding(\.apiKey))
                NumericField(title: "Batch Window", unit: "s", value: endpointBinding(\.batchWindowSeconds))
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Save") {
                    monitor.saveConfig()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
    }

    private func endpointBinding<T>(_ keyPath: WritableKeyPath<EndpointSettingsDraft, T>) -> Binding<T> {
        Binding(
            get: {
                guard let endpoint = monitor.settingsDraft.endpoints.first(where: { $0.id == endpointID }) else {
                    return EndpointSettingsDraft.defaultPrimary()[keyPath: keyPath]
                }
                return endpoint[keyPath: keyPath]
            },
            set: { value in
                guard let index = monitor.settingsDraft.endpoints.firstIndex(where: { $0.id == endpointID }) else {
                    return
                }
                monitor.settingsDraft.endpoints[index][keyPath: keyPath] = value
            }
        )
    }
}

private struct ReportingPane: View {
    @State private var apps: [InstalledReportingApp] = []
    @State private var selectedID: String = InstalledReportingApp.other.id
    @AppStorage("pulsebar.reporting.disabledBundleIds") private var disabledBundleIDsRaw = ""

    private var disabledBundleIDs: Set<String> {
        Set(disabledBundleIDsRaw.split(separator: ",").map(String.init))
    }

    private var selectedApp: InstalledReportingApp {
        apps.first { $0.id == selectedID } ?? .other
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Reporting")
                    .font(.title2.weight(.semibold))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                Divider()
                List(selection: $selectedID) {
                    ForEach(apps) { app in
                        ReportingAppListItem(
                            app: app,
                            enabled: isEnabled(app)
                        )
                        .tag(app.id)
                    }
                }
                .listStyle(.plain)
            }
            .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ReportingDetailPane(
                app: selectedApp,
                enabled: isEnabled(selectedApp),
                toggle: { setEnabled(!isEnabled(selectedApp), for: selectedApp) }
            )
        }
        .onAppear {
            apps = InstalledAppCatalog.load()
            if !apps.contains(where: { $0.id == selectedID }) {
                selectedID = apps.first?.id ?? InstalledReportingApp.other.id
            }
        }
    }

    private func isEnabled(_ app: InstalledReportingApp) -> Bool {
        if app.isOther { return true }
        return !disabledBundleIDs.contains(app.bundleID)
    }

    private func setEnabled(_ enabled: Bool, for app: InstalledReportingApp) {
        guard !app.isOther else { return }
        var next = disabledBundleIDs
        if enabled {
            next.remove(app.bundleID)
        } else {
            next.insert(app.bundleID)
        }
        disabledBundleIDsRaw = next.sorted().joined(separator: ",")
    }
}

private struct ReportingAppListItem: View {
    let app: InstalledReportingApp
    let enabled: Bool

    var body: some View {
        HStack(spacing: 12) {
            if app.isOther {
                Image(systemName: "tray.full")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .foregroundStyle(.secondary)
            } else {
                AppIconView(bundleId: app.bundleID, size: 28)
            }

            Text(app.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)

            Spacer()

            Text(enabled ? "Enabled" : "Disabled")
                .font(.caption.weight(.medium))
                .foregroundStyle(enabled ? Color.green : Color.secondary)
        }
        .padding(.vertical, 6)
    }
}

private struct ReportingDetailPane: View {
    let app: InstalledReportingApp
    let enabled: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 14) {
                if app.isOther {
                    Image(systemName: "tray.full")
                        .font(.system(size: 24, weight: .semibold))
                        .frame(width: 42, height: 42)
                        .foregroundStyle(.secondary)
                } else {
                    AppIconView(bundleId: app.bundleID, size: 42)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(app.name)
                        .font(.largeTitle.weight(.semibold))
                    Text(enabled ? "Enabled" : "Disabled")
                        .font(.headline)
                        .foregroundStyle(enabled ? Color.green : Color.secondary)
                }

                Spacer()

                Button(enabled ? "Disable" : "Enable", action: toggle)
                    .buttonStyle(.borderedProminent)
                    .disabled(app.isOther)
            }

            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct GlobalSettingsPane: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @AppStorage("pulsebar.launchAtLogin") private var launchAtLogin = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                Text("Settings")
                    .font(.largeTitle.weight(.semibold))

                DetailSection("Sampling") {
                    NumericField(
                        title: "App Sampling Interval",
                        unit: "ms",
                        value: draftBinding(\.appPollingMillis)
                    )
                }

                DetailSection("Detection") {
                    NumericField(
                        title: "Switch Detection Stability",
                        unit: "ms",
                        value: draftBinding(\.changeStabilityMillis)
                    )
                }

                DetailSection("System") {
                    Toggle("Launch at Login", isOn: $launchAtLogin)
                        .toggleStyle(.switch)
                }

                HStack {
                    Spacer()
                    Button("Save Changes") {
                        monitor.saveConfig()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(32)
            .frame(maxWidth: 760, alignment: .leading)
        }
    }

    private func draftBinding<T>(_ keyPath: WritableKeyPath<SettingsDraft, T>) -> Binding<T> {
        Binding(
            get: { monitor.settingsDraft[keyPath: keyPath] },
            set: { monitor.settingsDraft[keyPath: keyPath] = $0 }
        )
    }
}

private enum ConnectionRuntimeStatus: Equatable {
    case connected
    case disconnected
    case reconnecting

    var title: String {
        switch self {
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .reconnecting: return "reconnecting"
        }
    }

    /// Bridge to the Kotlin presentation-core enum of the same name.
    var kotlinRuntime: ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.ConnectionRuntimeStatus {
        switch self {
        case .connected: return .Connected
        case .disconnected: return .Disconnected
        case .reconnecting: return .Reconnecting
        }
    }

    var color: Color {
        switch self {
        case .connected: return .green
        case .disconnected: return .red
        case .reconnecting: return .yellow
        }
    }

    static func resolve(
        endpoint: EndpointSettingsDraft,
        sync: EndpointSyncStatusInfo?,
        manuallyDisconnected: Bool
    ) -> ConnectionRuntimeStatus {
        if manuallyDisconnected || !endpoint.enabled {
            return .disconnected
        }
        guard let sync else {
            return endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .disconnected : .reconnecting
        }
        if sync.status == "disabled" ||
            sync.status == "disconnected" ||
            sync.lastStatus == "skip:endpoint_disabled" ||
            sync.lastStatus == "skip:endpoint_disconnected" {
            return .reconnecting
        }
        switch sync.status {
        case "healthy":
            return .connected
        case "probing", "checking_server", "idle":
            return .reconnecting
        default:
            return .disconnected
        }
    }
}

private struct DetailSection<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.weight(.semibold))
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct KeyValueGrid: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows, id: \.0) { row in
                HStack(alignment: .top, spacing: 18) {
                    Text(row.0)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 130, alignment: .leading)
                    Text(row.1)
                        .font(.subheadline)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct LabeledField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            TextField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

private struct LabeledSecureField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            SecureField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

private struct NumericField: View {
    let title: String
    let unit: String
    @Binding var value: Int

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Text(title)
                .font(.headline)
            Spacer()
            TextField(title, value: $value, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 110)
                .multilineTextAlignment(.trailing)
            Text(unit)
                .font(.headline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

private struct InstalledReportingApp: Identifiable, Equatable {
    let id: String
    let name: String
    let bundleID: String
    let isOther: Bool

    static let other = InstalledReportingApp(
        id: "__pulsebar_other__",
        name: "Other",
        bundleID: "__pulsebar_other__",
        isOther: true
    )
}

private enum InstalledAppCatalog {
    static func load() -> [InstalledReportingApp] {
        var appsByBundleID: [String: InstalledReportingApp] = [InstalledReportingApp.other.bundleID: .other]
        let paths = [
            "/Applications",
            "/System/Applications",
            "/System/Applications/Utilities",
            NSHomeDirectory() + "/Applications",
        ]

        for path in paths {
            let url = URL(fileURLWithPath: path)
            guard let contents = try? FileManager.default.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.isApplicationKey],
                options: [.skipsHiddenFiles]
            ) else {
                continue
            }

            for appURL in contents where appURL.pathExtension == "app" {
                guard let bundle = Bundle(url: appURL),
                      let bundleID = bundle.bundleIdentifier else {
                    continue
                }
                let name =
                    bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ??
                    bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ??
                    appURL.deletingPathExtension().lastPathComponent
                appsByBundleID[bundleID] = InstalledReportingApp(
                    id: bundleID,
                    name: name,
                    bundleID: bundleID,
                    isOther: false
                )
            }
        }

        let sorted = appsByBundleID.values
            .filter { !$0.isOther }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return [.other] + sorted
    }
}

private func formatSyncDate(_ date: Date?) -> String {
    guard let date else { return "-" }
    return date.formatted(date: .omitted, time: .standard)
}
