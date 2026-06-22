import AppKit
import SwiftUI

@MainActor
final class PreferencesWindowController: NSObject, NSWindowDelegate {
    private let monitor: MonitorStore
    private var window: NSWindow?

    init(monitor: MonitorStore) {
        self.monitor = monitor
    }

    func show() {
        let preferencesWindow = window ?? makeWindow()
        NSApp.activate(ignoringOtherApps: true)
        preferencesWindow.makeKeyAndOrderFront(nil)
        preferencesWindow.orderFrontRegardless()
    }

    private func makeWindow() -> NSWindow {
        let hostingController = NSHostingController(
            rootView: PulseBarPreferencesView()
                .environmentObject(monitor)
                .frame(minWidth: 520, minHeight: 420)
        )
        let preferencesWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 480),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        preferencesWindow.title = "PulseBar 设置"
        preferencesWindow.contentViewController = hostingController
        preferencesWindow.isReleasedWhenClosed = false
        preferencesWindow.delegate = self
        preferencesWindow.center()
        window = preferencesWindow
        return preferencesWindow
    }
}
