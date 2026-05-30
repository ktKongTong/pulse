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
}
