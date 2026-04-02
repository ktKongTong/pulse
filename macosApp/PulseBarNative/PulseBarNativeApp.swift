import SwiftUI

@main
struct PulseBarNativeApp: App {
    @StateObject private var monitor = NativeMonitorModel()

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView()
                .environmentObject(monitor)
                .frame(width: 380)
                .task {
                    monitor.start()
                }
        } label: {
            Label("PulseBar", systemImage: monitor.isPaused ? "pause.circle" : "waveform.path.ecg")
        }
        .menuBarExtraStyle(.window)

        Settings {
            NativeSettingsView()
                .environmentObject(monitor)
                .frame(minWidth: 720, minHeight: 520)
        }
    }
}
