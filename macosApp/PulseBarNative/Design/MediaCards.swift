import SwiftUI
@preconcurrency import PulseBarShared

private typealias Formatters = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.PulseBarFormatters

struct PulseBarCurrentAppCard: View {
    let snapshot: PulseBarSnapshot

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            AppIconView(bundleId: snapshot.bundleId, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(snapshot.appName)
                    .font(.title2.weight(.bold))
                    .lineLimit(1)
                Text(snapshot.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                snapshot.pageTitle?.takeIfNotBlank().map {
                    Text($0)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
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

struct PulseBarMediaCard: View {
    let media: PulseBarMedia
    let onPrevious: () -> Void
    let onTogglePlayPause: () -> Void
    let onNext: () -> Void
    let onSeek: (Double) -> Void

    private var subtitle: String {
        "\(media.artist)\(media.album.map { " · \($0)" } ?? "")"
    }

    var body: some View {
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
                    } else if media.source.lowercased() == "music" {
                        ProviderIconBadge(bundleId: "com.apple.Music")
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(media.title)
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
                            Text(pulseProgressText(media))
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
                progressSeconds: media.progressSeconds,
                durationSeconds: Double(mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0),
                accentColor: .accentColor,
                onSeek: onSeek
            )
            .frame(height: 4)
        }
    }
}

/// Formatted clock string (`M:SS` / `H:MM:SS`). Thin wrapper over the
/// Kotlin `PulseBarFormatters.formatClock` helper.
func pulseClock(_ seconds: Int) -> String {
    Formatters.shared.formatClock(seconds: Int32(seconds))
}

/// Formatted `progress / duration` clock string.
func pulseProgressText(_ media: PulseBarMedia) -> String {
    let progress = Int(media.progressSeconds.rounded())
    let duration = mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0
    return "\(pulseClock(progress)) / \(pulseClock(duration))"
}

extension String {
    func takeIfNotBlank() -> String? {
        isEmpty ? nil : self
    }
}
