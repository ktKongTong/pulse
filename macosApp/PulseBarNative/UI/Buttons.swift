import SwiftUI

struct MediaTransportButton: View {
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
