package io.github.kt.pulsebar.core.platform

import kotlinx.cinterop.ExperimentalForeignApi
import platform.AppKit.NSWorkspace
import platform.Foundation.NSBundle
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSDateFormatterMediumStyle
import platform.Foundation.NSDateFormatterNoStyle
import platform.Foundation.NSString
import platform.Foundation.dateWithTimeIntervalSince1970

@OptIn(ExperimentalForeignApi::class)
internal actual fun resolveAppDisplayName(bundleId: String): String? {
    if (bundleId.isBlank() || bundleId == "unknown") return null
    // NSWorkspace.urlForApplication(withBundleIdentifier:) is only available
    // through the cinterop-generated @ObjCClass. Use the NSBundle shortcut
    // which works via NSBundle.bundleWithIdentifier.
    val bundle = NSBundle.bundleWithIdentifier(bundleId) ?: return null
    val info = bundle.infoDictionary ?: return null
    val display = info["CFBundleDisplayName"] as? String
    if (!display.isNullOrBlank()) return display
    val name = info["CFBundleName"] as? String
    if (!name.isNullOrBlank()) return name
    return null
}

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
