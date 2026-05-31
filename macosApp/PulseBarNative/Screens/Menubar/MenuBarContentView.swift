import AppKit
import SwiftUI
@preconcurrency import PulseBarShared

private let menuBarUsageRowLimit = 5

struct MenuBarContentView: View {
    @EnvironmentObject private var monitor: MonitorStore
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topSection

            if monitor.focusState != nil {
                Divider()
                    .padding(.vertical, 10)
            }

            if let media = monitor.currentMedia {
                mediaSection(media)
                Divider()
                    .padding(.vertical, 10)
            }

            bottomSection
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(MediaGlassBackground())
    }

    private var topSection: some View {
        HStack(alignment: .center, spacing: 10) {
            if let focusState = monitor.focusState {
                AppIconView(bundleId: focusState.id, size: 40)
                Text(focusState.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Image(systemName: "app.badge")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.secondary.opacity(0.10))
                    )
                Text("No Focus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                showDashboard(.connection)
            } label: {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .foregroundStyle(.secondary)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.secondary.opacity(0.08))
                    )
            }
            .buttonStyle(.plain)
        }
    }

    private func mediaSection(_ media: Media) -> some View {
        let durationSeconds = Double(mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0)
        return HStack(alignment: .center, spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                AsyncImage(url: media.artworkURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(.quaternary)
                        .overlay(Image(systemName: "music.note").font(.system(size: 16)).foregroundStyle(.secondary))
                }
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                if media.source.lowercased() == "spotify" {
                    ProviderIconBadge(bundleId: "com.spotify.client")
                } else if media.source.lowercased() == "apple-music" || media.source.lowercased() == "music" {
                    ProviderIconBadge(bundleId: "com.apple.Music")
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(media.displayTitle)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(media.displayArtist)
                        .font(.system(size: 10, weight: .light))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                HStack(spacing: 6) {
                    MediaTransportButton(systemName: "backward.fill", action: { monitor.mediaCommand(.PREVIOUS) })
                    Spacer(minLength: 0)
                    MediaTransportButton(systemName: media.isPlaying ? "pause.fill" : "play.fill", isPrimary: true, action: {
                        monitor.mediaCommand(.TOGGLE_PLAY_PAUSE)
                    })
                    Spacer(minLength: 0)
                    MediaTransportButton(systemName: "forward.fill", action: { monitor.mediaCommand(.NEXT) })
                }
                .frame(maxWidth: .infinity)
                MediaProgressTimeline(
                    progressSeconds: media.progressSeconds,
                    durationSeconds: durationSeconds,
                    isPlaying: media.isPlaying
                ) { displayedProgress in
                    VStack(alignment: .leading, spacing: 6) {
                        MediaSeekBar(
                            progressSeconds: displayedProgress,
                            durationSeconds: durationSeconds,
                            accentColor: .accentColor,
                            onSeek: { monitor.seekMedia(to: $0) }
                        )
                        .frame(height: 3)

                        HStack {
                            Text(pulseClock(Int(displayedProgress.rounded())))
                            Spacer()
                            Text(remainingClockText(media, progressSeconds: displayedProgress))
                        }
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 108)
    }

    private func showDashboard(_ section: DashboardSection) {
        monitor.dashboardSelection = section
        openWindow(id: "dashboard")
        DashboardWindow.focus()
    }

    private var bottomSection: some View {
        Group {
            if !monitor.todayStats.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(monitor.todayStats.prefix(menuBarUsageRowLimit))) { row in
                        UsageRowView(row: row, totalSeconds: monitor.todayTotalSeconds)
                    }
                }
            }
        }
    }

    private func remainingClockText(_ media: Media, progressSeconds: Double? = nil) -> String {
        let duration = mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0
        let progress = Int((progressSeconds ?? media.progressSeconds).rounded())
        let remaining = max(0, duration - progress)
        return "-\(pulseClock(remaining))"
    }
}

private struct UsageRowView: View {
    let row: AppUsageItem
    let totalSeconds: Int

    private var percentage: Int {
        guard totalSeconds > 0 else { return 0 }
        return Int((Double(row.totalSeconds) / Double(totalSeconds) * 100).rounded())
    }

    private var ratio: Double {
        guard totalSeconds > 0 else { return 0 }
        return min(max(Double(row.totalSeconds) / Double(totalSeconds), 0), 1)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            AppIconView(bundleId: row.bundleId, size: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.label)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                    Spacer(minLength: 12)
                    Text(durationText)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.secondary.opacity(0.12))
                            Capsule()
                                .fill(Color.accentColor)
                                .frame(width: max(10, geometry.size.width * ratio))
                        }
                    }
                    .frame(height: 4)
                    Text("\(percentage)%")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var durationText: String {
        pulseDurationHuman(seconds: row.totalSeconds)
    }
}
