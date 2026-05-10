import AppKit
import SwiftUI
@preconcurrency import PulseBarShared

private typealias Formatters = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.PulseBarFormatters

struct MediaGlassBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
        } else {
            content
                .background(.regularMaterial, in: .rect(cornerRadius: 16))
        }
    }
}
struct MenuBarContentView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topSection

            if monitor.snapshot != nil {
                Divider()
                    .padding(.vertical, 10)
            }

            if let media = monitor.snapshot?.media {
                mediaSection(media)
                Divider()
                    .padding(.vertical, 10)
            }

            bottomSection
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(
            MediaGlassBackground()
        )
    }

    private var topSection: some View {
        HStack(alignment: .center, spacing: 10) {
            if let snapshot = monitor.snapshot {
                AppIconView(bundleId: snapshot.bundleId, size: 40)
                Text(snapshot.appName)
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

    private func mediaSection(_ media: PulseBarMedia) -> some View {
        HStack(alignment: .center, spacing: 10) {
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
                } else if media.source.lowercased() == "music" {
                    ProviderIconBadge(bundleId: "com.apple.Music")
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(media.title)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(media.artist)
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
                VStack(alignment: .leading, spacing: 6) {
                    MediaSeekBar(
                        progressSeconds: media.progressSeconds,
                        durationSeconds: Double(mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0),
                        accentColor: .accentColor,
                        onSeek: { monitor.seekMedia(to: $0) }
                    )
                    .frame(height: 3)

                    HStack {
                        Text(pulseClock(Int(media.progressSeconds.rounded())))
                        Spacer()
                        Text(remainingClockText(media))
                    }
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 108)
    }

    private func showDashboard(_ section: DashboardSection) {
        monitor.dashboardSelection = section
        openWindow(id: "dashboard")
        focusPulseBarDashboardWindow()
    }

    private var bottomSection: some View {
        Group {
            if !monitor.todayStats.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(monitor.todayStats.prefix(2))) { row in
                        UsageRowView(row: row, totalSeconds: monitor.todayTotalSeconds)
                    }
                }
            }
        }
    }

    private func remainingClockText(_ media: PulseBarMedia) -> String {
        // Kotlin owns the clock formatting; menubar wants just the leading
        // negative-remaining segment ("-M:SS") without the " / total" suffix.
        let duration = mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0
        let progress = Int(media.progressSeconds.rounded())
        let remaining = max(0, duration - progress)
        return "-\(Formatters.shared.formatClock(seconds: Int32(remaining)))"
    }
}

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

private struct UsageRowView: View {
    let row: PulseBarUsageRow

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
        Formatters.shared.formatDurationHuman(seconds: Int32(row.totalSeconds))
    }
}

private struct MediaTransportButton: View {
    let systemName: String
    var isPrimary: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: isPrimary ? 20 : 15, weight: .semibold))
                .foregroundStyle(Color.primary.opacity(isPrimary ? 0.9 : 0.75))
                .frame(width: isPrimary ? 30 : 22, height: isPrimary ? 30 : 22)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
    }
}

private extension String {
    func takeIfNotBlank() -> String? {
        isEmpty ? nil : self
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

struct PulseBarIconButton: View {
    let systemName: String
    var isPrimary: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: isPrimary ? 28 : 26, height: isPrimary ? 28 : 26)
                .foregroundStyle(isPrimary ? .white : .secondary)
        }
        .buttonStyle(.plain)
        .background(
            Circle()
                .fill(isPrimary ? Color.accentColor : Color.secondary.opacity(0.10))
        )
        .overlay(
            Circle()
                .stroke(Color.white.opacity(isPrimary ? 0.0 : 0.22), lineWidth: 0.5)
        )
        .contentShape(Circle())
    }
}

@MainActor
func focusPulseBarDashboardWindow() {
    NSApp.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
        if let window = NSApp.windows.first(where: { $0.title == "PulseBar" }) {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
    }
}

private struct MarqueeText: View {
    let text: String
    let font: Font
    let lineLimit: Int

    @State private var animate = false

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            ZStack(alignment: .leading) {
                Text(text)
                    .font(font)
                    .lineLimit(lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
                    .offset(x: animate ? -max(0, width * 0.22) : 0)
                    .animation(
                        text.count > 12
                            ? .easeInOut(duration: 3.2).repeatForever(autoreverses: true)
                            : .default,
                        value: animate
                    )
            }
            .clipped()
            .onAppear {
                if text.count > 12 {
                    animate = true
                }
            }
        }
        .frame(height: lineLimit > 1 ? 54 : 28)
    }
}

private struct ProviderIconBadge: View {
    let bundleId: String

    var body: some View {
        AppIconView(bundleId: bundleId, size: 22)
            .background(
                Circle()
                    .fill(Color.white)
                    .frame(width: 24, height: 24)
            )
            .offset(x: -4, y: -4)
    }
}

private struct MediaSeekBar: View {
    let progressSeconds: Double
    let durationSeconds: Double
    let accentColor: Color
    let onSeek: (Double) -> Void

    @State private var dragProgress: Double? = nil
    @State private var visualProgress: Double = 0
    @State private var isDragging = false
    @State private var lastSeekAt: Date? = nil

    private let trackHeight: CGFloat = 4
    private let thumbWidth: CGFloat = 5
    private let thumbHeight: CGFloat = 16
    private let thumbGap: CGFloat = 4

    var body: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 1)
            let displayed = dragProgress ?? visualProgress
            let normalized = durationSeconds > 0 ? min(max(displayed / durationSeconds, 0), 1) : 0
            ZStack {
                Capsule()
                    .fill(Color.secondary.opacity(0.14))
                    .frame(width: width, height: trackHeight)

                HStack {
                    Capsule()
                        .fill(accentColor.opacity(0.95))
                        .frame(width: max(0, width * normalized), height: trackHeight)
                    Spacer(minLength: 0)
                }
                .frame(width: width, height: trackHeight)

                if isDragging {
                    RoundedRectangle(cornerRadius: thumbWidth / 2)
                        .fill(accentColor.opacity(0.95))
                        .frame(width: thumbWidth, height: thumbHeight)
                        .offset(x: width * normalized - width / 2)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        isDragging = true
                        let ratio = min(max(value.location.x / width, 0), 1)
                        dragProgress = ratio * durationSeconds
                    }
                    .onEnded { value in
                        let ratio = min(max(value.location.x / width, 0), 1)
                        let target = ratio * durationSeconds
                        visualProgress = target
                        dragProgress = nil
                        isDragging = false
                        lastSeekAt = Date()
                        onSeek(target)
                    }
            )
        }
        .onAppear {
            visualProgress = progressSeconds
        }
        .onChange(of: progressSeconds) { _, newValue in
            let recentlySought = lastSeekAt.map { Date().timeIntervalSince($0) < 0.8 } ?? false
            if !isDragging && !recentlySought {
                visualProgress = newValue
            }
        }
    }
}

struct AppIconView: View {
    let bundleId: String
    var size: CGFloat = 24

    var body: some View {
        Group {
            if let image = appImage() {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.12))
                    .overlay(
                        Image(systemName: "app.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func appImage() -> NSImage? {
        AppIconCache.shared.image(for: bundleId)
    }
}

@MainActor
private final class AppIconCache {
    static let shared = AppIconCache()

    private let cache = NSCache<NSString, NSImage>()

    func image(for bundleId: String) -> NSImage? {
        let key = bundleId as NSString
        if let image = cache.object(forKey: key) {
            return image
        }
        guard let path = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)?.path else {
            return nil
        }
        let image = NSWorkspace.shared.icon(forFile: path)
        cache.setObject(image, forKey: key)
        return image
    }
}

func pulseClock(_ seconds: Int) -> String {
    Formatters.shared.formatClock(seconds: Int32(seconds))
}

func pulseProgressText(_ media: PulseBarMedia) -> String {
    let progress = Int(media.progressSeconds.rounded())
    let duration = mediaDurationSecondsOrNull(media: media).map(Int.init) ?? 0
    return "\(pulseClock(progress)) / \(pulseClock(duration))"
}
