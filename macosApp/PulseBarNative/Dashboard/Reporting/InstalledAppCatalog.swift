import Foundation

enum InstalledAppCatalog {
    static func load() -> [InstalledReportingApp] {
        var appsByBundleID: [String: InstalledReportingApp] = [InstalledReportingApp.other.bundleID: .other]
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
                    bundleID: bundleID,
                    isOther: false
                )
            }
        }

        let sorted = appsByBundleID.values
            .filter { !$0.isOther }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return [.other] + sorted
    }
}
