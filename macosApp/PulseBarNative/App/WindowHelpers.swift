import AppKit

/// Helpers that don't belong to any one scene. Scoped under
/// `DashboardWindow` to avoid shadowing SwiftUI's `Window` scene type.
enum DashboardWindow {
    @MainActor
    static func focus() {
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            if let window = NSApp.windows.first(where: { $0.title == "PulseBar" }) {
                window.makeKeyAndOrderFront(nil)
                window.orderFrontRegardless()
            }
        }
    }
}
