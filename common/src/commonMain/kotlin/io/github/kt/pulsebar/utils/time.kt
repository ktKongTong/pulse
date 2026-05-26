package io.github.kt.pulsebar.utils

import kotlin.time.Clock
import kotlin.time.Instant


fun currentTimeMillis() = Clock.System.now().epochSeconds

fun iso8601(time: Long = currentTimeMillis()): String {
    val instant = Instant.fromEpochMilliseconds(time)
    return instant.toString()
}

internal fun nowInIso8601(): String {
    return Clock.System.now().toString()
}

internal fun nowInMillis(): Long = Clock.System.now().toEpochMilliseconds()