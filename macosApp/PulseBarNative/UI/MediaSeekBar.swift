import SwiftUI

struct MediaSeekBar: View {
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
