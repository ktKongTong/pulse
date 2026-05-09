package io.github.kt.pulsebar.core.log

import platform.Foundation.NSLog

internal actual fun platformLog(
    level: PulseLogLevel,
    category: PulseLogCategory,
    message: String,
    error: Throwable?,
) {
    val prefix = when (level) {
        PulseLogLevel.Debug -> "D"
        PulseLogLevel.Info -> "I"
        PulseLogLevel.Warn -> "W"
        PulseLogLevel.Error -> "E"
    }
    val line = if (error == null) {
        "[$prefix][${category.tag}] $message"
    } else {
        "[$prefix][${category.tag}] $message -- ${error::class.simpleName}: ${error.message ?: ""}"
    }
    NSLog("%s", line)
}
