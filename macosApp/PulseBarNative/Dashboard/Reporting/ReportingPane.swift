import SwiftUI

struct ReportingPane: View {
    @State private var apps: [InstalledReportingApp] = []
    @State private var selectedID: String = InstalledReportingApp.other.id
    @AppStorage("pulsebar.reporting.disabledBundleIds") private var disabledBundleIDsRaw = ""

    private var disabledBundleIDs: Set<String> {
        Set(disabledBundleIDsRaw.split(separator: ",").map(String.init))
    }

    private var selectedApp: InstalledReportingApp {
        apps.first { $0.id == selectedID } ?? .other
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Reporting")
                    .font(.title2.weight(.semibold))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                Divider()
                List(selection: $selectedID) {
                    ForEach(apps) { app in
                        ReportingAppListItem(
                            app: app,
                            enabled: isEnabled(app)
                        )
                        .tag(app.id)
                    }
                }
                .listStyle(.plain)
            }
            .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ReportingDetailPane(
                app: selectedApp,
                enabled: isEnabled(selectedApp),
                toggle: { setEnabled(!isEnabled(selectedApp), for: selectedApp) }
            )
        }
        .onAppear {
            apps = InstalledAppCatalog.load()
            if !apps.contains(where: { $0.id == selectedID }) {
                selectedID = apps.first?.id ?? InstalledReportingApp.other.id
            }
        }
    }

    private func isEnabled(_ app: InstalledReportingApp) -> Bool {
        if app.isOther { return true }
        return !disabledBundleIDs.contains(app.bundleID)
    }

    private func setEnabled(_ enabled: Bool, for app: InstalledReportingApp) {
        guard !app.isOther else { return }
        var next = disabledBundleIDs
        if enabled {
            next.remove(app.bundleID)
        } else {
            next.insert(app.bundleID)
        }
        disabledBundleIDsRaw = next.sorted().joined(separator: ",")
    }
}

private struct ReportingAppListItem: View {
    let app: InstalledReportingApp
    let enabled: Bool

    var body: some View {
        HStack(spacing: 12) {
            if app.isOther {
                Image(systemName: "tray.full")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .foregroundStyle(.secondary)
            } else {
                AppIconView(bundleId: app.bundleID, size: 28)
            }

            Text(app.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)

            Spacer()

            Text(enabled ? "Enabled" : "Disabled")
                .font(.caption.weight(.medium))
                .foregroundStyle(enabled ? Color.green : Color.secondary)
        }
        .padding(.vertical, 6)
    }
}

private struct ReportingDetailPane: View {
    let app: InstalledReportingApp
    let enabled: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 14) {
                if app.isOther {
                    Image(systemName: "tray.full")
                        .font(.system(size: 24, weight: .semibold))
                        .frame(width: 42, height: 42)
                        .foregroundStyle(.secondary)
                } else {
                    AppIconView(bundleId: app.bundleID, size: 42)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(app.name)
                        .font(.largeTitle.weight(.semibold))
                    Text(enabled ? "Enabled" : "Disabled")
                        .font(.headline)
                        .foregroundStyle(enabled ? Color.green : Color.secondary)
                }

                Spacer()

                Button(enabled ? "Disable" : "Enable", action: toggle)
                    .buttonStyle(.borderedProminent)
                    .disabled(app.isOther)
            }

            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
