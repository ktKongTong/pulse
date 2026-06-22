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
