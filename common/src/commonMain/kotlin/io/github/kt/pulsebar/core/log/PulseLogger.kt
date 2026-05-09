package io.github.kt.pulsebar.core.log

/**
 * Categories for PulseBar logs. Used as the `category` field in every log line
 * and (on platforms that support it) as the subsystem/category of native
 * unified logging.
 *
 * Categories line up 1:1 with the Phase 1 logging plan in
 * `docs/app/refactor-plan.md` §6.2. When adding a new category here, update
 * that section too.
 */
enum class PulseLogCategory(val raw: String) {
    AppLifecycle("app.lifecycle"),
    ConfigStore("config.store"),
    StatsRefresh("stats.refresh"),
    SyncEndpoint("sync.endpoint"),
    LiveListenSession("live_listen.session"),
    PlatformAdapter("platform.adapter"),
}

enum class PulseLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/**
 * Platform-agnostic logging facade.
 *
 * Phase 1 goal: every `println` / `NSLog` / `writeHttpLog` /
 * `/tmp/pulse-live-listen-native-debug.log` producer in the project ends up
 * routed through here. The concrete sink is platform-specific (os_log +
 * rotating file on macOS, stdout on JVM) but the structured schema of a line
 * is uniform:
 *
 * ```
 * <iso8601> [<level>] <category> event=<event> [k=v k=v...] [-- <detail>]
 * ```
 */
object PulseLogger {
    fun debug(
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) {
        emit(PulseLogLevel.Debug, category, event, fields, throwable)
    }

    fun info(
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) {
        emit(PulseLogLevel.Info, category, event, fields, throwable)
    }

    fun warn(
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) {
        emit(PulseLogLevel.Warn, category, event, fields, throwable)
    }

    fun error(
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?> = emptyMap(),
        throwable: Throwable? = null,
    ) {
        emit(PulseLogLevel.Error, category, event, fields, throwable)
    }

    private fun emit(
        level: PulseLogLevel,
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?>,
        throwable: Throwable?,
    ) {
        val rendered = formatLine(level, category, event, fields, throwable)
        platformLogSink(level, category, rendered)
    }

    internal fun formatLine(
        level: PulseLogLevel,
        category: PulseLogCategory,
        event: String,
        fields: Map<String, Any?>,
        throwable: Throwable?,
    ): String {
        val sb = StringBuilder()
        sb.append(currentIso8601())
        sb.append(" [")
        sb.append(
            when (level) {
                PulseLogLevel.Debug -> "debug"
                PulseLogLevel.Info -> "info"
                PulseLogLevel.Warn -> "warn"
                PulseLogLevel.Error -> "error"
            },
        )
        sb.append("] ")
        sb.append(category.raw)
        sb.append(" event=")
        sb.append(event)
        for ((key, value) in fields) {
            if (value == null) continue
            sb.append(' ')
            sb.append(key)
            sb.append('=')
            sb.append(renderFieldValue(value))
        }
        if (throwable != null) {
            sb.append(" -- ")
            sb.append(throwable::class.simpleName ?: "Throwable")
            val message = throwable.message
            if (!message.isNullOrBlank()) {
                sb.append(": ")
                sb.append(message)
            }
        }
        return sb.toString()
    }

    private fun renderFieldValue(value: Any): String {
        val raw = value.toString()
        return if (raw.any { it.isWhitespace() || it == '"' }) {
            "\"" + raw.replace("\"", "\\\"") + "\""
        } else {
            raw
        }
    }
}

internal expect fun platformLogSink(
    level: PulseLogLevel,
    category: PulseLogCategory,
    line: String,
)

internal expect fun currentIso8601(): String
