import AppKit
import Foundation

enum InstalledAppCatalog {
    private static func load() -> [InstalledReportingApp] {
        var appsByBundleID: [String: InstalledReportingApp] = [:]
        let paths = [
            "/Applications",
            "/System/Applications",
            "/System/Applications/Utilities",
            NSHomeDirectory() + "/Applications",
        ]

        for path in paths {
            let url = URL(fileURLWithPath: path)
            guard let contents = try? FileManager.default.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.isApplicationKey],
                options: [.skipsHiddenFiles]
            ) else {
                continue
            }

            for appURL in contents where appURL.pathExtension == "app" {
                guard let bundle = Bundle(url: appURL),
                      let bundleID = bundle.bundleIdentifier else {
                    continue
                }
                let name =
                    bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ??
                    bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ??
                    appURL.deletingPathExtension().lastPathComponent
                appsByBundleID[bundleID] = InstalledReportingApp(
                    id: bundleID,
                    name: name,
                    bundleID: bundleID
                )
            }
        }

        return appsByBundleID.values
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func loadAsync() async -> [InstalledReportingApp] {
        await Task.detached(priority: .userInitiated) {
            load()
        }.value
    }
}

enum AppIconLoader {
    private static func load(bundleId: String) -> NSImage? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            return nil
        }
        return NSWorkspace.shared.icon(forFile: url.path)
    }

    static func loadAsync(bundleId: String) async -> NSImage? {
        await Task.detached(priority: .utility) {
            load(bundleId: bundleId)
        }.value
    }
}
