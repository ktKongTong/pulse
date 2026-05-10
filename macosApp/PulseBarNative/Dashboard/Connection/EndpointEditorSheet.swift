import SwiftUI
@preconcurrency import PulseBarShared

struct EndpointEditorSheet: View {
    @EnvironmentObject private var monitor: MonitorStore
    @Environment(\.dismiss) private var dismiss

    let endpointID: String

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Edit Connection")
                .font(.title.weight(.semibold))

            VStack(alignment: .leading, spacing: 16) {
                LabeledField(title: "Name", text: endpointString(get: { $0.name }, set: { $0.name = $1 }))
                LabeledField(title: "Endpoint URL", text: endpointString(get: { $0.endpointUrl }, set: { $0.endpointUrl = $1 }))
                LabeledField(title: "Workspace ID", text: endpointString(get: { $0.workspaceId }, set: { $0.workspaceId = $1 }))
                LabeledField(title: "Site ID", text: endpointString(get: { $0.siteId }, set: { $0.siteId = $1 }))
                LabeledSecureField(title: "API Key", text: endpointString(get: { $0.apiKey }, set: { $0.apiKey = $1 }))
                NumericField(
                    title: "Batch Window",
                    unit: "s",
                    value: Binding<Int>(
                        get: {
                            guard let endpoint = monitor.settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return 15 }
                            return Int(endpoint.batchWindowSeconds)
                        },
                        set: { value in
                            guard let endpoint = monitor.settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
                            endpoint.batchWindowSeconds = Int32(value)
                            monitor.objectWillChange.send()
                        }
                    )
                )
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Save") {
                    monitor.saveConfig()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
    }

    private func endpointString(
        get: @escaping (PulseBarEndpointDraft) -> String,
        set: @escaping (PulseBarEndpointDraft, String) -> Void
    ) -> Binding<String> {
        Binding<String>(
            get: {
                guard let endpoint = monitor.settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return "" }
                return get(endpoint)
            },
            set: { value in
                guard let endpoint = monitor.settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
                set(endpoint, value)
                // `settingsDraft` is a Kotlin class reference — @Published won't
                // fire on internal field mutations, so nudge SwiftUI manually.
                monitor.objectWillChange.send()
            }
        )
    }
}
