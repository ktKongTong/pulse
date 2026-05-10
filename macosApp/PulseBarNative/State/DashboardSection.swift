import Foundation

/// SwiftUI navigation selection. SF Symbol names are Apple-only;
/// nothing to move to Kotlin.
enum DashboardSection: String, CaseIterable, Identifiable {
    case connection
    case reporting
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .connection: return "Connection"
        case .reporting: return "Reporting"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .connection: return "antenna.radiowaves.left.and.right"
        case .reporting: return "app.badge"
        case .settings: return "slider.horizontal.3"
        }
    }
}
