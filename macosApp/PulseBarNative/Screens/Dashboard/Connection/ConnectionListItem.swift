import SwiftUI
@preconcurrency import PulseBarShared

struct ConnectionListItem: View {
    let endpoint: EndpointConfig
    let status: PulseBarStreamConnectionState

    private var displayName: String {
        endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var endpointLabel: String {
        endpoint.url.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(status.color)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(displayName.isEmpty ? (endpointLabel.isEmpty ? "Untitled endpoint" : endpointLabel) : displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if !displayName.isEmpty, !endpointLabel.isEmpty {
                    Text(endpointLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(.vertical, 6)
    }
}
