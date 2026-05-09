package io.github.kt.pulsebar.core.log

import co.touchlab.kermit.Logger
import co.touchlab.kermit.Severity

/**
 * Categories used as the kermit `tag` for every PulseBar log line. Matches
 * `docs/app/refactor-plan.md` §6.2.
 */
enum class PulseLogCategory(val tag: String) {
    AppLifecycle("app.lifecycle"),
    ConfigStore("config.store"),
    StatsRefresh("stats.refresh"),
    SyncEndpoint("sync.endpoint"),
    LiveListenSession("live_listen.session"),
    PlatformAdapter("platform.adapter"),
}

private val loggers: Map<PulseLogCategory, Logger> =
    PulseLogCategory.entries.associateWith { Logger.withTag(it.tag) }

/** Kermit logger scoped to a PulseBar category. */
fun logger(category: PulseLogCategory): Logger = loggers.getValue(category)

object PulseLog {
    fun configure(minSeverity: Severity = Severity.Debug) {
        Logger.setMinSeverity(minSeverity)
    }
}
