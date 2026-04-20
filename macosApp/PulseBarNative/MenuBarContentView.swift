import AppKit
import SwiftUI

struct MenuBarContentView: View {
    @EnvironmentObject private var monitor: NativeMonitorModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            if let snapshot = monitor.snapshot {
                PulseBarCurrentAppCard(snapshot: snapshot)
            }

            if let media = monitor.snapshot?.media {
                PulseBarMediaCard(
                    media: media,
                    onPrevious: { monitor.mediaCommand(.PREVIOUS) },
                    onTogglePlayPause: { monitor.mediaCommand(.TOGGLE_PLAY_PAUSE) },
                    onNext: { monitor.mediaCommand(.NEXT) },
                    onSeek: { target in
                        monitor.seekMedia(to: target)
                    }
                )
            }

            todayStats
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(width: 392, height: 620)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Text("PulseBar")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
                if monitor.interactionPendingCount > 0 {
                    Text("\(monitor.interactionPendingCount)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.accentColor.opacity(0.16)))
                        .foregroundStyle(Color.accentColor)
                }
                Spacer()
                HStack(spacing: 8) {
                    PulseBarIconButton(systemName: "square.grid.2x2.fill") {
                        showDashboard(.dashboard)
                    }
                    PulseBarIconButton(
                        systemName: monitor.isPaused ? "play.fill" : "pause.fill",
                        isPrimary: true
                    ) {
                        monitor.togglePaused()
                    }
                    PulseBarIconButton(systemName: "gearshape.fill") {
                        showDashboard(.settings)
                    }
                }
            }
        }
    }

    private func showDashboard(_ section: DashboardSection) {
        monitor.dashboardSelection = section
        openWindow(id: "dashboard")
        focusPulseBarDashboardWindow()
    }

    private var todayStats: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack {
                Text("Today")
                    .font(.headline)
                Spacer()
                Text(formatDuration(monitor.todayTotalSeconds))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            if monitor.todayStats.isEmpty {
                Text("No tracked usage yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(monitor.todayStats) { row in
                            UsageRowView(
                                row: row,
                                totalSeconds: monitor.todayTotalSeconds
                            )
                        }
                    }
                }
                .frame(maxHeight: 320)
            }
        }
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

struct PulseBarCurrentAppCard: View {
    let snapshot: LiveSnapshot

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
    let media: MediaInfo
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
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.quaternary)
                            .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
                    }
                    .frame(width: 78, height: 78)
                    .clipShape(RoundedRectangle(cornerRadius: 18))

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

                        VStack(alignment: .trailing, spacing: 6) {
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
                durationSeconds: Double(media.durationSeconds ?? 0),
                accentColor: .accentColor,
                onSeek: onSeek
            )
            .frame(height: 12)
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

    private let trackHeight: CGFloat = 6
    private let thumbWidth: CGFloat = 4
    private let thumbHeight: CGFloat = 26
    private let thumbGap: CGFloat = 8

    var body: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 1)
            let displayed = dragProgress ?? visualProgress
            let normalized = durationSeconds > 0 ? min(max(displayed / durationSeconds, 0), 1) : 0
            let thumbCenterX = width * normalized
            let leftWidth = max(0, thumbCenterX - thumbGap)
            let rightStart = min(width, thumbCenterX + thumbGap)
            let rightWidth = max(0, width - rightStart)

            ZStack {
                HStack(spacing: 0) {
                    if leftWidth > 0 {
                        RoundedRectangle(cornerRadius: trackHeight / 2)
                            .fill(accentColor.opacity(0.95))
                            .frame(width: leftWidth, height: trackHeight)
                    } else {
                        Color.clear.frame(width: 0, height: trackHeight)
                    }

                    Color.clear.frame(width: thumbGap * 2, height: trackHeight)

                    if rightWidth > 0 {
                        RoundedRectangle(cornerRadius: trackHeight / 2)
                            .fill(Color.secondary.opacity(0.15))
                            .frame(width: rightWidth, height: trackHeight)
                    } else {
                        Color.clear.frame(width: 0, height: trackHeight)
                    }
                }
                .frame(width: width, height: trackHeight)

                RoundedRectangle(cornerRadius: thumbWidth / 2)
                    .fill(accentColor.opacity(0.95))
                    .frame(width: thumbWidth, height: thumbHeight)
                    .offset(x: thumbCenterX - width / 2)
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
        .onChange(of: progressSeconds) { newValue in
            let recentlySought = lastSeekAt.map { Date().timeIntervalSince($0) < 0.8 } ?? false
            if !isDragging && !recentlySought {
                visualProgress = newValue
            }
        }
    }
}

private struct UsageRowView: View {
    let row: UsageRow
    let totalSeconds: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AppIconView(bundleId: row.bundleId, size: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(row.label)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            VStack(alignment: .trailing, spacing: 4) {
                Text(durationText)
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(.secondary)
                Text(percentageText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 72, alignment: .trailing)
        }
        .padding(.vertical, 2)
    }

    private var durationText: String {
        let h = row.totalSeconds / 3600
        let m = (row.totalSeconds % 3600) / 60
        let s = row.totalSeconds % 60
        if h > 0 { return String(format: "%dh %02dm", h, m) }
        if m > 0 { return String(format: "%dm %02ds", m, s) }
        return "\(s)s"
    }

    private var percentageText: String {
        guard totalSeconds > 0 else { return "0%" }
        let percent = Int((Double(row.totalSeconds) / Double(totalSeconds) * 100).rounded())
        return "\(percent)%"
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
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}

func pulseProgressText(_ media: MediaInfo) -> String {
    let progress = Int(media.progressSeconds.rounded())
    let duration = media.durationSeconds ?? 0
    return "\(pulseClock(progress)) / \(pulseClock(duration))"
}

private extension String {
    func takeIfNotBlank() -> String? {
        isEmpty ? nil : self
    }
}
