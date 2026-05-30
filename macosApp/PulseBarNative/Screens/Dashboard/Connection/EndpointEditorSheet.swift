import SwiftUI
@preconcurrency import PulseBarShared

struct EndpointEditorSheet: View {
    @EnvironmentObject private var monitor: MonitorStore
    @Environment(\.dismiss) private var dismiss

    let endpointID: String
    @State private var name = ""
    @State private var url = ""
    @State private var workspaceId = ""
    @State private var siteId = ""
    @State private var apiKey = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Edit Connection")
                .font(.title.weight(.semibold))

            VStack(alignment: .leading, spacing: 16) {
                LabeledField(title: "Name", text: $name)
                LabeledField(title: "Endpoint URL", text: $url)
                LabeledField(title: "Workspace ID", text: $workspaceId)
                LabeledField(title: "Site ID", text: $siteId)
                LabeledSecureField(title: "API Key", text: $apiKey)
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Save") {
                    guard let current = monitor.settings.endpoints.first(where: { $0.id == endpointID }) else {
                        dismiss()
                        return
                    }
                    monitor.updateEndpoint(
                        EndpointConfig(
                            id: current.id,
                            name: name,
                            enabled: current.enabled,
                            url: url,
                            siteId: siteId,
                            workspaceId: workspaceId,
                            apiKey: apiKey
                        )
                    )
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
        .onAppear(perform: loadEndpoint)
    }

    private func loadEndpoint() {
        guard let endpoint = monitor.settings.endpoints.first(where: { $0.id == endpointID }) else { return }
        name = endpoint.name
        url = endpoint.url
        workspaceId = endpoint.workspaceId
        siteId = endpoint.siteId
        apiKey = endpoint.apiKey
    }
}
