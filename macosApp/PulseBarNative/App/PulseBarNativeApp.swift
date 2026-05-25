import SwiftUI
import AppKit

@MainActor
final class PulseBarNativeAppDelegate: NSObject, NSApplicationDelegate {
    let monitor = MonitorStore()
    private var statusItemController: StatusItemController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        monitor.start()
        monitor.requestStreamAudioCapturePermissionAtStartup()
        statusItemController = StatusItemController(monitor: monitor)
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        monitor.resumeAndRefresh()
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
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    appDelegate.monitor.dashboardSelection = .settings
                    DashboardWindow.focus()
                }
                .keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(after: .appSettings) {
                Button(appDelegate.monitor.isMonitoring ? "Stop Monitoring" : "Start Monitoring") {
                    if appDelegate.monitor.isMonitoring {
                        appDelegate.monitor.stop()
                    } else {
                        appDelegate.monitor.start()
                    }
                }
                .disabled(appDelegate.monitor.isPermissionPromptBlockingInteraction)
                .keyboardShortcut("m", modifiers: [.command, .shift])
            }
        }
    }
}
