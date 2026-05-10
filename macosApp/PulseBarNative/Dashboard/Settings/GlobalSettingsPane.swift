import SwiftUI
@preconcurrency import PulseBarShared

struct GlobalSettingsPane: View {
    @EnvironmentObject private var monitor: MonitorStore
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
                        value: Binding<Int>(
                            get: { Int(monitor.settingsDraft.appPollingMillis) },
                            set: {
                                monitor.settingsDraft.appPollingMillis = Int32($0)
                                monitor.objectWillChange.send()
                            }
                        )
                    )
                }

                DetailSection("Detection") {
                    NumericField(
                        title: "Switch Detection Stability",
                        unit: "ms",
                        value: Binding<Int>(
                            get: { Int(monitor.settingsDraft.changeStabilityMillis) },
                            set: {
                                monitor.settingsDraft.changeStabilityMillis = Int32($0)
                                monitor.objectWillChange.send()
                            }
                        )
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
}
