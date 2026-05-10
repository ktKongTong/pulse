package io.github.kt.pulsebar.core.platform

// JVM has no bundle catalogue — callers fall back to the untouched name.
internal actual fun resolveAppDisplayName(bundleId: String): String? = null
