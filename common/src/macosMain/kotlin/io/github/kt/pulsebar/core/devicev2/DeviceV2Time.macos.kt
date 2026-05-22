package io.github.kt.pulsebar.core.devicev2

import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter

internal fun deviceV2NowIso(): String {
    val formatter = NSDateFormatter().apply { dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX" }
    return formatter.stringFromDate(NSDate())
}

internal fun deviceV2NowMillis(): Long = (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

