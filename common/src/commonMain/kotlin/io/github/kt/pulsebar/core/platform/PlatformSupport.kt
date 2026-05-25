package io.github.kt.pulsebar.core.platform

/**
 * Platform hooks that shared code needs but cannot implement itself. Each
 * macOS actual lives in `macosMain`; JVM tests get neutral stubs.
 */

/**
 * Resolve the user-facing application name for [bundleId] from the platform
 * bundle catalogue. Returns null when the platform can't find a matching
 * bundle, in which case callers should fall back to the untouched name.
 *
 * macOS resolves this from `NSBundle.bundleWithIdentifier` and caches both
 * hits and misses because focus events can repeat the same bundle id. JVM
 * returns null.
 */
internal expect fun resolveAppDisplayName(bundleId: String): String?

/**
 * Format a millisecond timestamp as a locale-aware wall-clock (time-only)
 * string for the dashboard's "last probe / last success / last failure"
 * rows. Returns `"-"` for null or zero millis (the "never happened"
 * sentinel used elsewhere).
 *
 * macOS uses `NSDateFormatter.localizedStringFromDate` with the user's
 * current locale. JVM returns an ISO-like `HH:mm:ss` so tests are stable.
 */
expect fun formatWallClockTime(epochMillis: Long?): String

/**
 * Parse an ISO8601 timestamp string (with or without fractional seconds)
 * into an epoch millisecond count. Returns null for null/empty/unparseable
 * input. Centralised so Swift (and any future shell) doesn't need to keep
 * a cached `ISO8601DateFormatter` around.
 *
 * macOS uses `NSISO8601DateFormatter` with a fractional-seconds fallback.
 * JVM uses `java.time.Instant.parse` followed by the same fallback.
 */
expect fun parseIso8601ToMillis(value: String?): Long?

/**
 * Generate a lowercase hex UUIDv4 suitable for PulseBar endpoint IDs.
 *
 * macOS uses `NSUUID.UUIDString.lowercased()`. JVM uses
 * `java.util.UUID.randomUUID()`. Moved here so Swift doesn't keep its
 * own `UUID()` path — one less place to diverge.
 */
expect fun newPulseUuid(): String

/**
 * Normalize a user-entered endpoint base URL so downstream consumers have
 * a clean host (no trailing path like `/api/v2/presence/ingest`,
 * `/api/v1/stream`, or legacy stream paths). Returns null when the URL
 * can't be parsed or ends up empty.
 *
 * Moved to Kotlin so both the presence reporter and the Stream client
 * use the exact same normalization. Previously the Swift UI did its own
 * stripping in `StreamEndpointConfig.normalizedStreamBaseURL`.
 */
fun normalizePulseBaseUrl(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    val suffixes = listOf(
        "/api/v2/presence/ingest",
        "/v2/presence/ingest",
        "/api/v1/meta",
        "/v1/meta",
        "/api/v1/stream",
        "/v1/stream",
        "/api/v1/live-listen",
        "/v1/live-listen",
    )
    // Parse scheme://host[:port]/path
    val schemeEnd = trimmed.indexOf("://")
    val base = if (schemeEnd < 0) trimmed else trimmed
    var working = base
    // Strip trailing query/fragment
    working = working.substringBefore('?').substringBefore('#')
    // Strip any of the known suffixes from the path
    for (suffix in suffixes) {
        if (working.endsWith(suffix)) {
            working = working.dropLast(suffix.length)
            break
        }
    }
    // Strip trailing slash (but keep the scheme's `://`)
    while (working.endsWith("/") && !working.endsWith("://")) {
        working = working.dropLast(1)
    }
    return working.ifEmpty { null }
}
