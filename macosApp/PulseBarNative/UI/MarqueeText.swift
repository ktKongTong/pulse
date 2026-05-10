import SwiftUI

/// Currently unused — previously driving track-title scroll. Kept for
/// re-use when a constrained width marquee is needed again.
struct MarqueeText: View {
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
