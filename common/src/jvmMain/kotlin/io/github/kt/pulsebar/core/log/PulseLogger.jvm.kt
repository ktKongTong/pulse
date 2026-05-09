package io.github.kt.pulsebar.core.log

import java.time.Instant

internal actual fun platformLogSink(
    level: PulseLogLevel,
    category: PulseLogCategory,
    line: String,
) {
    val stream = if (level == PulseLogLevel.Warn || level == PulseLogLevel.Error) System.err else System.out
    stream.println(line)
}

internal actual fun currentIso8601(): String =
    Instant.now().toString()
