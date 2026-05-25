package io.github.kt.pulsebar.core.platform

import kotlinx.cinterop.ExperimentalForeignApi
import platform.AppKit.NSWorkspace
import platform.Foundation.NSBundle
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSDateFormatterMediumStyle
import platform.Foundation.NSDateFormatterNoStyle
import platform.Foundation.NSISO8601DateFormatWithFractionalSeconds
import platform.Foundation.NSISO8601DateFormatWithInternetDateTime
import platform.Foundation.NSISO8601DateFormatter
import platform.Foundation.NSLock
import platform.Foundation.NSString
import platform.Foundation.NSUUID
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.timeIntervalSince1970

@OptIn(ExperimentalForeignApi::class)
internal actual fun resolveAppDisplayName(bundleId: String): String? {
    if (bundleId.isBlank() || bundleId == "unknown") return null
    appDisplayNameCacheLock.lock()
    try {
        appDisplayNameCache[bundleId]?.let { return it.value }
    } finally {
        appDisplayNameCacheLock.unlock()
    }

    // Touching the bundle catalogue can wake macOS security services. Cache
    // both hits and misses so repeated focus events do not repeat it.
    val resolved = run {
        val bundle = NSBundle.bundleWithIdentifier(bundleId) ?: return@run null
        val info = bundle.infoDictionary ?: return@run null
        val display = info["CFBundleDisplayName"] as? String
        if (!display.isNullOrBlank()) return@run display
        val name = info["CFBundleName"] as? String
        if (!name.isNullOrBlank()) return@run name
        null
    }
    appDisplayNameCacheLock.lock()
    try {
        appDisplayNameCache[bundleId] = CachedAppDisplayName(resolved)
    } finally {
        appDisplayNameCacheLock.unlock()
    }
    return resolved
}

private data class CachedAppDisplayName(val value: String?)

private val appDisplayNameCacheLock = NSLock()
private val appDisplayNameCache = mutableMapOf<String, CachedAppDisplayName>()

/** Cache one formatter — NSDateFormatter is expensive to allocate per call. */
private val wallClockTimeFormatter: NSDateFormatter by lazy {
    NSDateFormatter().apply {
        dateStyle = NSDateFormatterNoStyle
        timeStyle = NSDateFormatterMediumStyle
    }
}

actual fun formatWallClockTime(epochMillis: Long?): String {
    if (epochMillis == null || epochMillis == 0L) return "-"
    val seconds = epochMillis.toDouble() / 1000.0
    val date = NSDate.dateWithTimeIntervalSince1970(seconds)
    return wallClockTimeFormatter.stringFromDate(date)
}

/** Matches `2026-05-10T12:34:56.789Z` / `+08:00` / etc. */
private val iso8601FractionalFormatter: NSISO8601DateFormatter by lazy {
    NSISO8601DateFormatter().apply {
        formatOptions = NSISO8601DateFormatWithInternetDateTime or
            NSISO8601DateFormatWithFractionalSeconds
    }
}

/** Fallback when the wire doesn't carry fractional seconds. */
private val iso8601PlainFormatter: NSISO8601DateFormatter by lazy {
    NSISO8601DateFormatter().apply {
        formatOptions = NSISO8601DateFormatWithInternetDateTime
    }
}

actual fun parseIso8601ToMillis(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    val parsed = iso8601FractionalFormatter.dateFromString(value)
        ?: iso8601PlainFormatter.dateFromString(value)
        ?: return null
    return (parsed.timeIntervalSince1970 * 1000.0).toLong()
}

actual fun newPulseUuid(): String =
    NSUUID().UUIDString().lowercase()
