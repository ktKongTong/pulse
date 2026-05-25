import AppKit
import SwiftUI
@preconcurrency import PulseBarShared

struct PulseBarDashboardView: View {
    @EnvironmentObject private var monitor: MonitorStore

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 0) {
                List(
                    DashboardSection.allCases,
                    selection: Binding(
                        get: { monitor.dashboardSelection },
                        set: { monitor.dashboardSelection = $0 ?? .connection }
                    )
                ) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
                .listStyle(.sidebar)

                SidebarMediaSummary(media: monitor.snapshot?.media)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 16)
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 248)
        } detail: {
            Group {
                switch monitor.dashboardSelection {
                case .connection:
                    ConnectionPane()
                case .reporting:
                    ReportingPane()
                case .settings:
                    GlobalSettingsPane()
                }
            }
            .environmentObject(monitor)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
            .disabled(monitor.isPermissionPromptBlockingInteraction)
            .overlay {
                if monitor.isPermissionPromptBlockingInteraction {
                    PermissionPendingOverlay()
                }
            }
        }
    }
}

private struct PermissionPendingOverlay: View {
    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .opacity(0.72)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text("Waiting for system audio permission")
                    .font(.headline)
                Text("Respond to the macOS permission prompt to continue.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

private struct SidebarMediaSummary: View {
    let media: PulseBarMedia?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            if let media {
                HStack(spacing: 10) {
                    AsyncImage(url: media.artworkURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(.quaternary)
                            .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
                    }
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 5))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(media.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(media.artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "music.note")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .foregroundStyle(.secondary)
                    Text("No media")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
