import SwiftUI
import AppKit

@MainActor
final class PulseBarNativeAppDelegate: NSObject, NSApplicationDelegate {
    let monitor = NativeMonitorModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        monitor.start()
    }
}

@main
struct PulseBarNativeApp: App {
    @NSApplicationDelegateAdaptor(PulseBarNativeAppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("PulseBar", id: "dashboard") {
            PulseBarDashboardView()
                .environmentObject(appDelegate.monitor)
                .frame(minWidth: 1080, minHeight: 720)
        }
        .defaultSize(width: 1180, height: 780)

        MenuBarExtra {
            MenuBarContentView()
                .environmentObject(appDelegate.monitor)
                .frame(width: 380)
        } label: {
            Label("PulseBar", systemImage: appDelegate.monitor.isPaused ? "pause.circle" : "waveform.path.ecg")
        }
        .menuBarExtraStyle(.window)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    appDelegate.monitor.dashboardSelection = .settings
                    focusPulseBarDashboardWindow()
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
