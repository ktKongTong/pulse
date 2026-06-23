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

    func showPreferences() {
        statusItemController?.showPreferences()
    }
}

@main
struct PulseBarNativeApp: App {
    @NSApplicationDelegateAdaptor(PulseBarNativeAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings...") {
                    appDelegate.showPreferences()
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
