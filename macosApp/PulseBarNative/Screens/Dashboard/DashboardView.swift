import AppKit
import ServiceManagement
import SwiftUI
@preconcurrency import PulseBarShared

private enum PreferencesTab: String, CaseIterable, Hashable, Identifiable {
    case general
    case reporting

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "通用"
        case .reporting: return "报告"
        }
    }
}

private struct ConnectionEditorDraft {
    var url = ""
    var deviceId = ""
    var apiKey = ""
}

enum LaunchAtLoginService {
    private static var isEnabled: Bool {
        switch SMAppService.mainApp.status {
        case .enabled, .requiresApproval:
            return true
        case .notRegistered, .notFound:
            return false
        @unknown default:
            return false
        }
    }

    private static func setEnabled(_ enabled: Bool) throws {
        let service = SMAppService.mainApp
        switch (enabled, service.status) {
        case (true, .enabled), (true, .requiresApproval):
            return
        case (true, _):
            try service.register()
        case (false, .notRegistered), (false, .notFound):
            return
        case (false, _):
            try service.unregister()
        }
    }

    static func setEnabledAsync(_ enabled: Bool) async throws -> Bool {
        try await Task.detached(priority: .userInitiated) {
            try setEnabled(enabled)
            return isEnabled
        }.value
    }

    static func isEnabledAsync() async -> Bool {
        await Task.detached(priority: .utility) {
            isEnabled
        }.value
    }
}

struct PulseBarPreferencesView: View {
    @EnvironmentObject private var monitor: MonitorStore
    @State private var selectedTab: PreferencesTab = .general
    @State private var launchAtLogin = false
    @State private var isLaunchAtLoginUpdating = false
    @State private var audioStreamingAllowed = false
    @State private var selectedAudioSourceId = StreamCaptureStore.autoSourceId
    @State private var connectionDraft = ConnectionEditorDraft()
    @State private var isEditingConnection = false
    @State private var didSyncRuntimeSettingsState = false
    @State private var isSynchronizingRuntimeSettingsState = false
    @State private var reportingApps: [InstalledReportingApp] = []
    @State private var isLoadingReportingApps = false
    @State private var hasLoadedReportingApps = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                ForEach(PreferencesTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 180)
            .padding(.top, 16)
            .padding(.bottom, 14)

            Group {
                switch selectedTab {
                case .general:
                    GeneralPreferencesPane(
                        launchAtLogin: $launchAtLogin,
                        isLaunchAtLoginUpdating: $isLaunchAtLoginUpdating,
                        audioStreamingAllowed: $audioStreamingAllowed,
                        selectedAudioSourceId: $selectedAudioSourceId,
                        connectionDraft: $connectionDraft,
                        isEditingConnection: $isEditingConnection,
                        didSyncRuntimeSettingsState: $didSyncRuntimeSettingsState,
                        isSynchronizingRuntimeSettingsState: $isSynchronizingRuntimeSettingsState
                    )
                case .reporting:
                    ReportingPreferencesPane(
                        apps: $reportingApps,
                        isLoadingApps: $isLoadingReportingApps,
                        hasLoadedApps: $hasLoadedReportingApps
                    )
                }
            }
            .environmentObject(monitor)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 520, minHeight: 420)
        .background(Color(nsColor: .windowBackgroundColor))
        .disabled(monitor.isPermissionPromptBlockingInteraction)
        .overlay {
            if monitor.isPermissionPromptBlockingInteraction {
                PermissionPendingOverlay()
            }
        }
    }
}

private struct GeneralPreferencesPane: View {
    @EnvironmentObject private var monitor: MonitorStore
    @Binding var launchAtLogin: Bool
    @Binding var isLaunchAtLoginUpdating: Bool
    @Binding var audioStreamingAllowed: Bool
    @Binding var selectedAudioSourceId: String
    @Binding var connectionDraft: ConnectionEditorDraft
    @Binding var isEditingConnection: Bool
    @Binding var didSyncRuntimeSettingsState: Bool
    @Binding var isSynchronizingRuntimeSettingsState: Bool
    @State private var launchAtLoginErrorMessage: String?
    @State private var isLaunchAtLoginErrorPresented = false

    private var endpoint: EndpointConfig? {
        monitor.settings?.endpoints.first
    }

    private var connectionState: PulseBarConnectionState? {
        guard let endpoint else { return nil }
        return monitor.connectionStatesByEndpointID[endpoint.id]
    }

    private var connectionColor: Color {
        if endpoint?.enabled == false { return .gray }
        return connectionState?.connectionStatus.color ?? .gray
    }

    private var connectionText: String {
        if endpoint?.enabled == false { return "已停止" }
        if connectionState?.connectionStatus.isConnected == true { return "已连接" }
        return "未连接"
    }

    private var serverAddressText: String {
        endpoint?.url.isEmpty == false ? endpoint?.url ?? "-" : "-"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    GroupedSettingsSection("连接") {
                        SettingsCard {
                            SettingsCardRow("状态") {
                                HStack(spacing: 12) {
                                    StatusDot(color: connectionColor)
                                    Text(connectionText)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Button("编辑...", action: beginEditingConnection)
                                        .disabled(endpoint == nil)
                                }
                            }

                            SettingsCardDivider()

                            SettingsCardRow("地址") {
                                Text(serverAddressText)
                                    .lineLimit(1)
                                    .truncationMode(.middle)

                                Spacer()

                                Button(action: copyServerAddress) {
                                    Image(systemName: "doc.on.doc")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                                .disabled(endpoint?.url.isEmpty != false)
                                .help("复制服务器地址")
                            }
                        }
                    }

                    GroupedSettingsSection("启动") {
                        SettingsCard {
                            SettingsCardRow("登录时启动") {
                                Spacer()
                                Toggle("", isOn: $launchAtLogin)
                                    .toggleStyle(.switch)
                                    .labelsHidden()
                                    .disabled(isLaunchAtLoginUpdating)
                            }
                        }
                    }

                    GroupedSettingsSection("音频") {
                        SettingsCard {
                            SettingsCardRow("允许串流音频") {
                                Spacer()
                                Toggle("", isOn: $audioStreamingAllowed)
                                .toggleStyle(.switch)
                                .labelsHidden()
                            }

                            SettingsCardDivider()

                            SettingsCardRow("音频源") {
                                Spacer()
                                Picker(
                                    "",
                                    selection: $selectedAudioSourceId
                                ) {
                                    Text("自动").tag(StreamCaptureStore.autoSourceId)
                                    ForEach(monitor.streamStore.sources, id: \.id) { source in
                                        Text(displayName(for: source)).tag(source.id)
                                    }
                                }
                                .pickerStyle(.menu)
                                .labelsHidden()
                                .frame(width: 112)
                            }

                            SettingsCardDivider()

                            SettingsCardRow("音频权限", labelWidth: nil, spacing: 10) {
                                HStack(spacing: 0) {
                                    StatusDot(color: capturePermissionColor)
                                    Spacer()
                                    Button("打开系统设置...", action: openSystemSettings)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 2)
                .padding(.bottom, 14)
            }

            HStack {
                Spacer()
                Button("关于 PulseBar...", action: showAboutPanel)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 14)
        }
        .sheet(isPresented: $isEditingConnection) {
            ConnectionEditorSheet(
                draft: $connectionDraft,
                cancel: { isEditingConnection = false },
                save: saveConnectionDraft
            )
        }
        .alert(
            "无法更新登录项",
            isPresented: $isLaunchAtLoginErrorPresented
        ) {
            Button("好", role: .cancel) {
                launchAtLoginErrorMessage = nil
            }
        } message: {
            Text(launchAtLoginErrorMessage ?? "")
        }
        .task {
            if !didSyncRuntimeSettingsState {
                await syncRuntimeSettingsState()
                didSyncRuntimeSettingsState = true
                if monitor.streamStore.sources.isEmpty {
                    monitor.streamStore.refreshSourcesAsync()
                }
                monitor.streamStore.refreshAudioCapturePermissionStatusAsync()
            }
        }
        .onChange(of: launchAtLogin) { _, enabled in
            guard !isSynchronizingRuntimeSettingsState else { return }
            submitLaunchAtLogin(enabled)
        }
        .onChange(of: audioStreamingAllowed) { _, enabled in
            guard !isSynchronizingRuntimeSettingsState else { return }
            submitAudioStreamingAllowed(enabled)
        }
        .onChange(of: selectedAudioSourceId) { _, sourceId in
            if monitor.streamStore.selectedSourceId != sourceId {
                monitor.streamStore.selectedSourceId = sourceId
            }
        }
    }

    private var capturePermissionColor: Color {
        switch monitor.streamStore.audioCapturePermissionStatus {
        case .authorized: return .green
        case .denied: return .red
        case .unknown: return .yellow
        }
    }

    private func beginEditingConnection() {
        guard let endpoint else { return }
        connectionDraft = ConnectionEditorDraft(
            url: endpoint.url,
            deviceId: endpoint.deviceId,
            apiKey: endpoint.apiKey
        )
        isEditingConnection = true
    }

    private func saveConnectionDraft() {
        guard let endpoint else { return }
        monitor.updateEndpoint(
            EndpointConfig(
                id: endpoint.id,
                name: endpoint.name,
                enabled: endpoint.enabled,
                url: connectionDraft.url,
                deviceId: connectionDraft.deviceId,
                apiKey: connectionDraft.apiKey
            )
        )
        isEditingConnection = false
    }

    private func submitLaunchAtLogin(_ enabled: Bool) {
        guard !isLaunchAtLoginUpdating else { return }
        isLaunchAtLoginUpdating = true
        Task {
            do {
                let actualValue = try await LaunchAtLoginService.setEnabledAsync(enabled)
                launchAtLogin = actualValue
            } catch {
                launchAtLoginErrorMessage = error.localizedDescription
                isLaunchAtLoginErrorPresented = true
                launchAtLogin = await LaunchAtLoginService.isEnabledAsync()
            }
            isLaunchAtLoginUpdating = false
        }
    }

    private func submitAudioStreamingAllowed(_ enabled: Bool) {
        monitor.streamStore.setStreamPermission(enabled ? .ALLOW : .DISALLOW)
    }

    private func syncRuntimeSettingsState() async {
        isSynchronizingRuntimeSettingsState = true
        defer { isSynchronizingRuntimeSettingsState = false }
        launchAtLogin = await LaunchAtLoginService.isEnabledAsync()
        audioStreamingAllowed = monitor.streamStore.streamPermission == .ALLOW
        selectedAudioSourceId = monitor.streamStore.selectedSourceId
    }

    private func copyServerAddress() {
        guard let url = endpoint?.url, !url.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }

    private func displayName(for source: StreamCaptureSource) -> String {
        source.name == "System Audio" ? "系统音频" : source.name
    }

    private func showAboutPanel() {
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    private func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
}

private struct ReportingPreferencesPane: View {
    @Binding var apps: [InstalledReportingApp]
    @Binding var isLoadingApps: Bool
    @Binding var hasLoadedApps: Bool
    @AppStorage("pulsebar.reporting.disabledBundleIds") private var disabledBundleIDsRaw = ""

    private var disabledBundleIDs: Set<String> {
        Set(disabledBundleIDsRaw.split(separator: ",").map(String.init))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PreferencesSection("Application rules") {
                    if isLoadingApps && apps.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                                .controlSize(.small)
                            Text("正在加载应用...")
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 220)
                    } else {
                        ReportingRulesTable(
                            apps: apps,
                            isEnabled: isEnabled,
                            setEnabled: setEnabled
                        )
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 18)
        }
        .task {
            await refreshAppsIfNeeded()
        }
    }

    private func refreshAppsIfNeeded() async {
        guard !hasLoadedApps, !isLoadingApps else { return }
        isLoadingApps = true
        apps = await InstalledAppCatalog.loadAsync()
        hasLoadedApps = true
        isLoadingApps = false
    }

    private func isEnabled(_ app: InstalledReportingApp) -> Bool {
        return !disabledBundleIDs.contains(app.bundleID)
    }

    private func setEnabled(_ enabled: Bool, for app: InstalledReportingApp) {
        var next = disabledBundleIDs
        if enabled {
            next.remove(app.bundleID)
        } else {
            next.insert(app.bundleID)
        }
        disabledBundleIDsRaw = next.sorted().joined(separator: ",")
    }
}

private struct ConnectionEditorSheet: View {
    @Binding var draft: ConnectionEditorDraft
    let cancel: () -> Void
    let save: () -> Void
    @State private var showsAPIKey = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("编辑连接")
                .font(.title2.weight(.semibold))

            VStack(alignment: .leading, spacing: 14) {
                ConnectionEditorRow("服务器地址") {
                    TextField("https://pulse.example.com", text: $draft.url)
                        .textFieldStyle(.roundedBorder)
                }

                ConnectionEditorRow("客户端 ID") {
                    TextField("client-id", text: $draft.deviceId)
                        .textFieldStyle(.roundedBorder)
                }

                ConnectionEditorRow("API Key") {
                    APIKeyPreferenceField(text: $draft.apiKey, isVisible: $showsAPIKey)
                }
            }

            HStack {
                Spacer()
                Button("取消", action: cancel)
                    .keyboardShortcut(.cancelAction)
                Button("保存", action: save)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(18)
        .frame(width: 400)
    }
}

private struct ConnectionEditorRow<Content: View>: View {
    private let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.medium))
            content
        }
    }
}

private struct GroupedSettingsSection<Content: View>: View {
    private let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SettingsCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 1)
        )
    }
}

private struct SettingsCardRow<Content: View>: View {
    private let title: String
    private let labelWidth: CGFloat?
    private let spacing: CGFloat
    private let content: Content

    init(
        _ title: String,
        labelWidth: CGFloat? = 150,
        spacing: CGFloat = 16,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.labelWidth = labelWidth
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .center, spacing: spacing) {
            Text(title)
                .font(.body.weight(.medium))
                .frame(width: labelWidth, alignment: .leading)
                .lineLimit(1)

            content
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 42)
    }
}

private struct SettingsCardDivider: View {
    var body: some View {
        Divider()
            .padding(.leading, 12)
    }
}

private struct PreferencesSection<Content: View>: View {
    private let title: String
    private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StatusDot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 14, height: 14)
    }
}

private struct APIKeyPreferenceField: View {
    @Binding var text: String
    @Binding var isVisible: Bool

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if isVisible {
                    TextField("", text: $text)
                } else {
                    SecureField("", text: $text)
                }
            }
            .textFieldStyle(.plain)

            Button {
                isVisible.toggle()
            } label: {
                Image(systemName: isVisible ? "eye.slash" : "eye")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help(isVisible ? "Hide API key" : "Show API key")
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
        )
    }
}

private struct ReportingRulesTable: View {
    let apps: [InstalledReportingApp]
    let isEnabled: (InstalledReportingApp) -> Bool
    let setEnabled: (Bool, InstalledReportingApp) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Application")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("Report")
                    .font(.headline)
                    .frame(width: 150, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .frame(height: 34)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(apps) { app in
                        ReportingRulesRow(
                            app: app,
                            isEnabled: isEnabled(app),
                            setEnabled: { setEnabled($0, app) }
                        )
                        Divider()
                    }
                }
            }
            .frame(height: 250)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 1)
        )
    }
}

private struct ReportingRulesRow: View {
    let app: InstalledReportingApp
    let isEnabled: Bool
    let setEnabled: (Bool) -> Void
    @State private var draftEnabled: Bool

    init(app: InstalledReportingApp, isEnabled: Bool, setEnabled: @escaping (Bool) -> Void) {
        self.app = app
        self.isEnabled = isEnabled
        self.setEnabled = setEnabled
        _draftEnabled = State(initialValue: isEnabled)
    }

    var body: some View {
        HStack(spacing: 12) {
            AppIconView(bundleId: app.bundleID, size: 28)
            Text(app.name)
                .lineLimit(1)
            Spacer()
            Toggle(
                "",
                isOn: $draftEnabled
            )
            .labelsHidden()
            .frame(width: 150, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .frame(height: 42)
        .background(Color(nsColor: .windowBackgroundColor))
        .onChange(of: isEnabled) { _, enabled in
            if draftEnabled != enabled {
                draftEnabled = enabled
            }
        }
        .onChange(of: draftEnabled) { _, enabled in
            if enabled != isEnabled {
                setEnabled(enabled)
            }
        }
    }
}

private struct PermissionPendingOverlay: View {
    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .opacity(0.72)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text("Waiting for system audio permission")
                    .font(.headline)
                Text("Respond to the macOS permission prompt to continue.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
