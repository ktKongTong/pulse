import SwiftUI
@preconcurrency import PulseBarShared

struct PulseBarCurrentAppCard: View {
    let focusState: FocusState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            AppIconView(bundleId: focusState.id, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(focusState.name)
                    .font(.title2.weight(.bold))
                    .lineLimit(1)
                Text(focusState.id)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.secondary.opacity(0.10))
        )
    }
}

struct MediaCard: View {
    let media: Media
    let onPrevious: () -> Void
    let onTogglePlayPause: () -> Void
    let onNext: () -> Void
    let onSeek: (Double) -> Void

    private var subtitle: String {
        "\(media.displayArtist)\(media.displayAlbum.map { " · \($0)" } ?? "")"
    }

    var body: some View {
        let durationSeconds = Double(mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0)
        MediaProgressTimeline(
            progressSeconds: media.progressSeconds,
            durationSeconds: durationSeconds,
            isPlaying: media.isPlaying
        ) { displayedProgress in
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    ZStack(alignment: .bottomTrailing) {
                        AsyncImage(url: media.artworkURL) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(.quaternary)
                                .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
                        }
                        .frame(width: 92, height: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                        if media.source.lowercased() == "spotify" {
                            ProviderIconBadge(bundleId: "com.spotify.client")
                        } else if media.source.lowercased() == "apple-music" || media.source.lowercased() == "music" {
                            ProviderIconBadge(bundleId: "com.apple.Music")
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(media.displayTitle)
                            .font(.headline.weight(.semibold))
                            .lineLimit(2)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .topLeading)

                        HStack(alignment: .bottom, spacing: 12) {
                            Text(subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .truncationMode(.tail)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                            VStack(alignment: .listRowSeparatorLeading, spacing: 6) {
                                HStack(spacing: 8) {
                                    PulseBarIconButton(systemName: "backward.fill", action: onPrevious)
                                    PulseBarIconButton(
                                        systemName: media.isPlaying ? "pause.fill" : "play.fill",
                                        isPrimary: true,
                                        action: onTogglePlayPause
                                    )
                                    PulseBarIconButton(systemName: "forward.fill", action: onNext)
                                }
                                Text(pulseProgressText(media, progressSeconds: displayedProgress))
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                            .fixedSize()
                            .frame(maxHeight: .infinity, alignment: .bottomTrailing)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    }
                    .frame(maxWidth: .infinity, minHeight: 78, maxHeight: 78, alignment: .topLeading)
                    .layoutPriority(1)
                }

                MediaSeekBar(
                    progressSeconds: displayedProgress,
                    durationSeconds: durationSeconds,
                    accentColor: .accentColor,
                    onSeek: onSeek
                )
                .frame(height: 4)
            }
        }
    }
}

/// Formatted clock string (`M:SS` / `H:MM:SS`).
func pulseClock(_ seconds: Int) -> String {
    let value = max(0, seconds)
    let hours = value / 3600
    let minutes = (value % 3600) / 60
    let seconds = value % 60
    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%d:%02d", minutes, seconds)
}

func pulseDurationHuman(seconds: Int32) -> String {
    let value = Int(seconds)
    if value >= 3600 {
        let hours = value / 3600
        let minutes = (value % 3600) / 60
        return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h"
    }
    if value >= 60 {
        return "\(value / 60)m"
    }
    return "\(value)s"
}

/// Formatted `progress / duration` clock string.
func pulseProgressText(_ media: Media) -> String {
    pulseProgressText(media, progressSeconds: media.progressSeconds)
}

func pulseProgressText(_ media: Media, progressSeconds: Double) -> String {
    let progress = Int(progressSeconds.rounded())
    let duration = mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0
    return "\(pulseClock(progress)) / \(pulseClock(duration))"
}

extension String {
    func takeIfNotBlank() -> String? {
        isEmpty ? nil : self
    }
}
