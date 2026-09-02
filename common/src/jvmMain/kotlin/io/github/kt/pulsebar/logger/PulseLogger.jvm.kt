package io.github.kt.pulsebar.logger

import co.touchlab.kermit.CommonWriter
import co.touchlab.kermit.LoggerConfig
import co.touchlab.kermit.Severity
import co.touchlab.kermit.loggerConfigInit

internal actual fun platformLoggerConfig(): LoggerConfig =
    loggerConfigInit(CommonWriter(), minSeverity = Severity.Debug)
