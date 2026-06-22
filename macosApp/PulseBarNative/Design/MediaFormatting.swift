import Foundation

/// Formatted clock string (`M:SS` / `H:MM:SS`).
func pulseClock(_ seconds: Int) -> String {
    let value = max(0, seconds)
    let hours = value / 3600
    let minutes = (value % 3600) / 60
    let seconds = value % 60
    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%d:%02d", minutes, seconds)
}

func pulseDurationHuman(seconds: Int32) -> String {
    let value = Int(seconds)
    if value >= 3600 {
        let hours = value / 3600
        let minutes = (value % 3600) / 60
        return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h"
    }
    if value >= 60 {
        return "\(value / 60)m"
    }
    return "\(value)s"
}

extension String {
    func takeIfNotBlank() -> String? {
        isEmpty ? nil : self
    }
}
