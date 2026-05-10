import AppKit
import SwiftUI

@MainActor
final class StatusItemController: NSObject {
    private let monitor: MonitorStore
    private let statusItem: NSStatusItem
    private let panel: NSPanel
    private let menu = NSMenu()
    private var localMonitor: Any?
    private var globalMonitor: Any?

    init(monitor: MonitorStore) {
        self.monitor = monitor
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 332, height: 392),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()
        configurePanel()
        configureStatusItem()
        configureMenu()
    }

    private func configurePanel() {
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.moveToActiveSpace, .transient, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.contentViewController = NSHostingController(
            rootView: MenuBarContentView()
                .environmentObject(monitor)
                .frame(width: 332)
        )
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        button.image = NSImage(systemSymbolName: "waveform.path.ecg", accessibilityDescription: "PulseBar")
        button.imagePosition = .imageOnly
        button.action = #selector(handleStatusItemClick(_:))
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    private func configureMenu() {
        let stopItem = NSMenuItem(title: "Stop Listening", action: #selector(stopListening), keyEquivalent: "")
        stopItem.target = self
        menu.addItem(stopItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit PulseBar", action: #selector(quitPulseBar), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)
    }

    @objc private func handleStatusItemClick(_ sender: Any?) {
        guard let button = statusItem.button else { return }
        switch NSApp.currentEvent?.type {
        case .rightMouseUp:
            closePanel()
            if let stopItem = menu.items.first {
                stopItem.isEnabled = monitor.isMonitoring
            }
            statusItem.menu = menu
            button.performClick(nil)
            statusItem.menu = nil
        default:
            if panel.isVisible {
                closePanel()
            } else {
                showPanel(relativeTo: button)
            }
        }
    }

    private func showPanel(relativeTo button: NSStatusBarButton) {
        guard let buttonWindow = button.window else { return }
        monitor.refreshMenuBarContent()
        PulseNativeLog.debug(.platformAdapter, "statusItem.panel.show")
        let buttonFrameInWindow = button.convert(button.bounds, to: nil)
        let buttonFrameOnScreen = buttonWindow.convertToScreen(buttonFrameInWindow)
        let screenFrame = buttonWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let panelSize = panel.frame.size
        let x = min(
            max(screenFrame.minX + 8, buttonFrameOnScreen.midX - panelSize.width / 2),
            screenFrame.maxX - panelSize.width - 8
        )
        let y = buttonFrameOnScreen.minY - panelSize.height - 6
        panel.setFrame(NSRect(origin: NSPoint(x: x, y: y), size: panelSize), display: false)
        installCloseMonitors()
        panel.orderFrontRegardless()
    }

    private func closePanel() {
        PulseNativeLog.debug(.platformAdapter, "statusItem.panel.hide")
        removeCloseMonitors()
        panel.orderOut(nil)
    }

    private func installCloseMonitors() {
        removeCloseMonitors()
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            self?.closePanelIfNeeded()
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.closePanelIfNeeded()
        }
    }

    private func removeCloseMonitors() {
        if let localMonitor {
            NSEvent.removeMonitor(localMonitor)
            self.localMonitor = nil
        }
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
            self.globalMonitor = nil
        }
    }

    private func closePanelIfNeeded() {
        guard panel.isVisible else { return }
        let mouseLocation = NSEvent.mouseLocation
        if panel.frame.contains(mouseLocation) { return }
        if let button = statusItem.button, let buttonWindow = button.window {
            let buttonFrameInWindow = button.convert(button.bounds, to: nil)
            let buttonFrameOnScreen = buttonWindow.convertToScreen(buttonFrameInWindow)
            if buttonFrameOnScreen.contains(mouseLocation) { return }
        }
        closePanel()
    }

    @objc private func stopListening() {
        monitor.stop()
    }

    @objc private func quitPulseBar() {
        NSApp.terminate(nil)
    }
}
