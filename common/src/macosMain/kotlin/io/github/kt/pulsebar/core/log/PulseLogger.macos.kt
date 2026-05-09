package io.github.kt.pulsebar.core.log

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSLog
import kotlin.experimental.ExperimentalNativeApi
import kotlin.native.Platform
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fprintf
import platform.posix.mkdir

@OptIn(ExperimentalForeignApi::class, ExperimentalNativeApi::class)
internal actual fun platformLogSink(
    level: PulseLogLevel,
    category: PulseLogCategory,
    line: String,
) {
    if (Platform.isDebugBinary) {
        NSLog("%s", line)
    }
    val home = NSHomeDirectory()
    mkdir("$home/Library/Logs", 0x1EDu)
    val logDirectory = "$home/Library/Logs/PulseBarNative"
    mkdir(logDirectory, 0x1EDu)
    val file = fopen("$logDirectory/pulsebar.log", "a") ?: return
    try {
        fprintf(file, "%s\n", line)
    } finally {
        fclose(file)
    }
}

internal actual fun currentIso8601(): String {
    val formatter = NSDateFormatter().apply {
        dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
    }
    return formatter.stringFromDate(NSDate())
}
