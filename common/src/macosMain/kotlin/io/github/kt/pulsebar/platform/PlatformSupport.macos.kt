package io.github.kt.pulsebar.platform

import platform.Foundation.NSBundle
import platform.Foundation.NSLock

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
