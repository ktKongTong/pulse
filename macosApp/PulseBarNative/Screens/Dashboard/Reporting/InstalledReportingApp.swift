import Foundation

struct InstalledReportingApp: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let bundleID: String
    let isOther: Bool

    static let other = InstalledReportingApp(
        id: "__pulsebar_other__",
        name: "Other",
        bundleID: "__pulsebar_other__",
        isOther: true
    )
}
