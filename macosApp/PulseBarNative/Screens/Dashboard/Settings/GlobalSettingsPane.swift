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
                        title: "Idle Threshold",
                        unit: "s",
                        value: Binding<Int>(
                            get: { Int(monitor.settings.idleThresholdSeconds) },
                            set: {
                                monitor.updateSettings(idleThresholdSeconds: Int32($0))
                            }
                        )
                    )
                }

                DetailSection("Detection") {
                    NumericField(
                        title: "Switch Detection Stability",
                        unit: "ms",
                        value: Binding<Int>(
                            get: { Int(monitor.settings.changeStabilityMillis) },
                            set: {
                                monitor.updateSettings(changeStabilityMillis: Int32($0))
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
                }
            }
            .padding(32)
            .frame(maxWidth: 760, alignment: .leading)
        }
    }
}
