import SwiftUI

struct MenuBarContentView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            if let snapshot = monitor.snapshot {
                currentStatus(snapshot)
            }

            if let media = monitor.snapshot?.media {
                mediaCard(media)
            }

            todayStats

            Divider()

            HStack(spacing: 10) {
                Button(monitor.isPaused ? "Resume monitoring" : "Pause monitoring") {
                    monitor.togglePaused()
                }
                Button("Open settings") {
                    openSettings()
                }
            }
        }
        .padding(16)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PulseBar")
                .font(.title2.weight(.semibold))
            Text(monitor.snapshot?.appName ?? "Starting monitor…")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private func currentStatus(_ snapshot: LiveSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let pageTitle = snapshot.pageTitle, !pageTitle.isEmpty {
                Text(pageTitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(snapshot.bundleId)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
    }

    private func mediaCard(_ media: MediaInfo) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: media.artworkURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                RoundedRectangle(cornerRadius: 14)
                    .fill(.quaternary)
                    .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            VStack(alignment: .leading, spacing: 6) {
                Text(media.title)
                    .font(.headline)
                    .lineLimit(2)
                Text("\(media.artist)\(media.album.map { " · \($0)" } ?? "")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(progressText(media))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var todayStats: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Text("Today")
                .font(.headline)
            if monitor.todayStats.isEmpty {
                Text("No tracked usage yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(monitor.todayStats) { row in
                    HStack {
                        Text(formatDuration(row.totalSeconds))
                            .font(.system(.subheadline, design: .monospaced))
                        Text(row.label)
                            .font(.subheadline)
                            .lineLimit(1)
                        Spacer()
                    }
                }
            }
        }
    }

    private func progressText(_ media: MediaInfo) -> String {
        let progress = Int(media.progressSeconds.rounded())
        let duration = media.durationSeconds ?? 0
        return "\(clock(progress)) / \(clock(duration))"
    }

    private func clock(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return String(format: "%dh %02dm", h, m) }
        if m > 0 { return String(format: "%dm %02ds", m, s) }
        return "\(s)s"
    }
}
