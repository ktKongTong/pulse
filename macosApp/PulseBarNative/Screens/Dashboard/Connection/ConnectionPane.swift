import AppKit
import SwiftUI
@preconcurrency import PulseBarShared

struct ConnectionPane: View {
    @EnvironmentObject private var monitor: MonitorStore
    @State private var selectedEndpointID: String?
    @State private var editingEndpointID: String?
    @State private var deleteCandidateID: String?

    private var endpoints: [PulseBarEndpointDraft] {
        monitor.settingsDraft.endpoints
    }

    private var selectedEndpoint: PulseBarEndpointDraft? {
        guard let selectedEndpointID else { return endpoints.first }
        return endpoints.first { $0.id == selectedEndpointID } ?? endpoints.first
    }

    var body: some View {
        HStack(spacing: 0) {
            connectionList
                .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            if let endpoint = selectedEndpoint {
                ConnectionDetailRoute(
                    endpoint: endpoint,
                    edit: { editingEndpointID = endpoint.id },
                    delete: { deleteCandidateID = endpoint.id }
                )
                .environmentObject(monitor)
            } else {
                EmptyConnectionPane {
                    addEndpoint()
                }
            }
        }
        .onAppear(perform: ensureSelection)
        .onChange(of: monitor.settingsDraft.endpoints.map(\.id)) { _, _ in ensureSelection() }
        .sheet(
            isPresented: Binding(
                get: { editingEndpointID != nil },
                set: { if !$0 { editingEndpointID = nil } }
            )
        ) {
            if let editingEndpointID {
                EndpointEditorSheet(endpointID: editingEndpointID)
                    .environmentObject(monitor)
                    .frame(width: 560, height: 620)
            }
        }
        .alert(
            "Delete Connection?",
            isPresented: Binding(
                get: { deleteCandidateID != nil },
                set: { if !$0 { deleteCandidateID = nil } }
            )
        ) {
            Button("Delete", role: .destructive) {
                if let id = deleteCandidateID {
                    monitor.connectionStore(endpointId: id).removeEndpoint()
                    monitor.removeConnectionStore(endpointId: id)
                }
                deleteCandidateID = nil
            }
            Button("Cancel", role: .cancel) {
                deleteCandidateID = nil
            }
        } message: {
            Text("This removes the endpoint configuration from PulseBar.")
        }
    }

    private var connectionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Connection")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button {
                    addEndpoint()
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)

            Divider()

            List(selection: $selectedEndpointID) {
                ForEach(endpoints) { endpoint in
                    ConnectionListItem(
                        endpoint: endpoint,
                        status: connectionStatus(endpoint)
                    )
                    .tag(endpoint.id)
                }
            }
            .listStyle(.plain)
        }
    }

    private func addEndpoint() {
        // monitor.addEndpoint()
        selectedEndpointID = monitor.settingsDraft.endpoints.last?.id
        editingEndpointID = selectedEndpointID
    }

    private func ensureSelection() {
        if selectedEndpointID == nil || !endpoints.contains(where: { $0.id == selectedEndpointID }) {
            selectedEndpointID = endpoints.first?.id
        }
    }

    private func connectionStatus(_ endpoint: PulseBarEndpointDraft) -> PulseBarStreamConnectionState {
        if !endpoint.enabled {
            return .STOPPED
        }
        return monitor.connectionStatesByEndpointID[endpoint.id]?.connectionState ?? .IDLE
    }
}

private struct ConnectionDetailRoute: View {
    @EnvironmentObject private var monitor: MonitorStore
    let endpoint: PulseBarEndpointDraft
    let edit: () -> Void
    let delete: () -> Void

    var body: some View {
        ConnectionDetailPane(endpoint: endpoint, edit: edit, delete: delete)
            .environmentObject(monitor.connectionStore(endpointId: endpoint.id))
    }
}

struct EmptyConnectionPane: View {
    let add: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("No connections")
                .font(.title2.weight(.semibold))
            Button("Add Connection", action: add)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
