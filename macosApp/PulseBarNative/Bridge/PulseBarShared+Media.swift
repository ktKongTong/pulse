import Foundation
@preconcurrency import PulseBarShared

// MARK: - Media derived properties
//
// Kotlin holds the canonical `artworkUrl: String?`; Swift needs a
// `Foundation.URL` for `AsyncImage`. Thin conversion layer, no parsing
// logic — Kotlin already handles URL validation.

extension Media {
    /// Wraps the Kotlin `String?` URL in a Foundation `URL` for `AsyncImage`.
    var artworkURL: URL? { artworkUrl.flatMap(URL.init(string:)) }

    var source: String { providerId ?? "" }

    var displayTitle: String {
        SharedFormatters.takeIfNotBlank(value: title) ?? "No title"
    }

    var displayArtist: String {
        SharedFormatters.takeIfNotBlank(value: artist) ?? "Unknown artist"
    }
}
