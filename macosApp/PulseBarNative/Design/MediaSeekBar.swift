import SwiftUI
@preconcurrency import PulseBarShared

struct MediaProgressTimeline<Content: View>: View {
    let progressSeconds: Double
    let durationSeconds: Double
    let playbackStatus: PulsePlaybackStatus

    private let content: (Double) -> Content

    @State private var baseProgressSeconds: Double = 0
    @State private var baseDate: Date = .now
    @State private var hasBase = false
    @State private var tickDate: Date = .now

    init(
        progressSeconds: Double,
        durationSeconds: Double,
        playbackStatus: PulsePlaybackStatus,
        @ViewBuilder content: @escaping (Double) -> Content
    ) {
        self.progressSeconds = progressSeconds
        self.durationSeconds = durationSeconds
        self.playbackStatus = playbackStatus
        self.content = content
    }

    var body: some View {
        content(displayProgress(at: tickDate))
        .onAppear {
            let now = Date.now
            tickDate = now
            resetBase(to: progressSeconds, at: now)
        }
        .onChange(of: progressSeconds) { _, newValue in
            let now = Date.now
            tickDate = now
            resetBase(to: newValue, at: now)
        }
        .onChange(of: playbackStatus) { _, _ in
            let now = Date.now
            tickDate = now
            resetBase(to: displayProgress(at: now), at: now)
        }
        .onChange(of: durationSeconds) { _, _ in
            let now = Date.now
            tickDate = now
            resetBase(to: displayProgress(at: now), at: now)
        }
        .task(id: playbackStatus) {
            tickDate = .now
            guard playbackStatus == .PLAYING else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                tickDate = .now
            }
        }
    }

    private func displayProgress(at date: Date) -> Double {
        let base = hasBase ? baseProgressSeconds : progressSeconds
        let elapsed = playbackStatus == .PLAYING ? max(0, date.timeIntervalSince(baseDate)) : 0
        return clamped(base + elapsed)
    }

    private func resetBase(to progress: Double, at date: Date) {
        baseProgressSeconds = clamped(progress)
        baseDate = date
        hasBase = true
    }

    private func clamped(_ progress: Double) -> Double {
        let lowerBounded = max(0, progress)
        guard durationSeconds > 0 else { return lowerBounded }
        return min(lowerBounded, durationSeconds)
    }
}

struct MediaSeekBar: View {
    let progressSeconds: Double
    let durationSeconds: Double
    let accentColor: Color
    let onSeek: (Double) -> Void

    @State private var dragProgress: Double? = nil
    @State private var seekPreviewProgress: Double? = nil
    @State private var isDragging = false
    @State private var lastSeekAt: Date? = nil

    private let trackHeight: CGFloat = 4
    private let thumbWidth: CGFloat = 5
    private let thumbHeight: CGFloat = 16

    var body: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 1)
            let displayed = dragProgress ?? seekPreviewProgress ?? progressSeconds
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
                        seekPreviewProgress = target
                        dragProgress = nil
                        isDragging = false
                        lastSeekAt = Date()
                        onSeek(target)
                    }
            )
        }
        .onChange(of: progressSeconds) { _, _ in
            let recentlySought = lastSeekAt.map { Date().timeIntervalSince($0) < 0.8 } ?? false
            if !isDragging && !recentlySought {
                seekPreviewProgress = nil
            }
        }
    }
}
