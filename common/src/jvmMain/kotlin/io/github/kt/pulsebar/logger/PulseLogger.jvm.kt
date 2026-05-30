package io.github.kt.pulsebar.logger

import java.time.Instant

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
    val stream = if (level == PulseLogLevel.Warn || level == PulseLogLevel.Error) System.err else System.out
    stream.println("${Instant.now()} [$prefix][${category.tag}] $message")
    if (error != null) {
        error.printStackTrace(stream)
    }
}
