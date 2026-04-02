import SwiftUI
import PulseBarShared

struct NativeSettingsView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @State private var saved = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("PulseBar Settings")
                    .font(.largeTitle.weight(.semibold))

                Form {
                    Section("Runtime") {
                        LabeledContent("Current app", value: monitor.snapshot?.appName ?? "Unknown")
                        LabeledContent("Bundle ID", value: monitor.snapshot?.bundleId ?? "unknown")
                        Toggle("Pause monitoring", isOn: Binding(
                            get: { monitor.isPaused },
                            set: { _ in monitor.togglePaused() }
                        ))
                    }

                    Section("Endpoint") {
                        Toggle("Enable endpoint", isOn: Binding(
                            get: { monitor.settingsDraft.endpointEnabled },
                            set: { monitor.settingsDraft.endpointEnabled = $0 }
                        ))
                        Picker("Transport", selection: Binding(
                            get: { monitor.settingsDraft.transport },
                            set: { monitor.settingsDraft.transport = $0 }
                        )) {
                            ForEach(TransportOption.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                        TextField("Endpoint URL", text: Binding(
                            get: { monitor.settingsDraft.endpointUrl },
                            set: { monitor.settingsDraft.endpointUrl = $0 }
                        ))
                        TextField("API Key", text: Binding(
                            get: { monitor.settingsDraft.apiKey },
                            set: { monitor.settingsDraft.apiKey = $0 }
                        ))
                    }

                    Section("Sampling") {
                        LabeledContent("Idle threshold", value: "\(monitor.settingsDraft.idleThresholdSeconds)s")
                        LabeledContent("Change stability", value: "\(monitor.settingsDraft.changeStabilityMillis)ms")
                        LabeledContent("Heartbeat", value: "\(monitor.settingsDraft.heartbeatSeconds)s")
                        LabeledContent("App polling", value: "\(monitor.settingsDraft.appPollingMillis)ms")
                        LabeledContent("Page polling", value: "\(monitor.settingsDraft.pagePollingMillis)ms")
                        LabeledContent("Media polling", value: "\(monitor.settingsDraft.mediaPollingMillis)ms")
                    }

                    Section("Media") {
                        LabeledContent("Source", value: monitor.snapshot?.media?.source ?? "None")
                        LabeledContent("Track", value: monitor.snapshot?.media?.title ?? "None")
                        LabeledContent("Artist", value: monitor.snapshot?.media?.artist ?? "None")
                    }
                }
                .formStyle(.grouped)

                HStack {
                    Button("Save") {
                        monitor.saveConfig()
                        saved = true
                    }
                    if saved {
                        Text("Saved")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(20)
    }
}
