package io.github.kt.pulsebar.core.platform

import kotlinx.cinterop.ExperimentalForeignApi
import platform.AppKit.NSWorkspace
import platform.Foundation.NSBundle
import platform.Foundation.NSString

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
