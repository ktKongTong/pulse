import SwiftUI
@preconcurrency import PulseBarShared

enum EndpointEditorMode: Equatable {
    case add
    case edit
}

struct EndpointEditorDraft: Identifiable {
    let mode: EndpointEditorMode
    let endpoint: EndpointConfig

    var id: String { endpoint.id }
}

struct EndpointEditorSheet: View {
    @Environment(\.dismiss) private var dismiss

    let draft: EndpointEditorDraft
    let onSave: (EndpointConfig) -> Void

    @State private var name = ""
    @State private var url = ""
    @State private var deviceId = ""
    @State private var apiKey = ""
    @State private var validationMessage: String?

    init(draft: EndpointEditorDraft, onSave: @escaping (EndpointConfig) -> Void) {
        self.draft = draft
        self.onSave = onSave
        _name = State(initialValue: draft.endpoint.name)
        _url = State(initialValue: draft.endpoint.url)
        _deviceId = State(initialValue: draft.endpoint.deviceId)
        _apiKey = State(initialValue: draft.endpoint.apiKey)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(draft.mode == .add ? "Add Connection" : "Edit Connection")
                .font(.title.weight(.semibold))

            VStack(alignment: .leading, spacing: 16) {
                LabeledField(title: "Name", text: $name)
                LabeledField(title: "Endpoint URL", text: $url)
                LabeledField(title: "Device ID", text: $deviceId)
                LabeledSecureField(title: "API Key", text: $apiKey)
            }

            if let validationMessage {
                Text(validationMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Save") {
                    guard let endpoint = validatedEndpoint() else { return }
                    onSave(endpoint)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
    }

    private func validatedEndpoint() -> EndpointConfig? {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDeviceId = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAPIKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmedURL.isEmpty {
            validationMessage = "Endpoint URL is required."
            return nil
        }
        if trimmedDeviceId.isEmpty {
            validationMessage = "Device ID is required."
            return nil
        }
        validationMessage = nil
        return EndpointConfig(
            id: draft.endpoint.id,
            name: trimmedName.isEmpty ? draft.endpoint.displayName : trimmedName,
            enabled: draft.endpoint.enabled,
            url: trimmedURL,
            deviceId: trimmedDeviceId,
            apiKey: trimmedAPIKey
        )
    }
}
