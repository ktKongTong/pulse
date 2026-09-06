package io.github.kt.pulsebar.flowipc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Stand-in for the real Kotlin shared runtime: it owns long-lived state as a
 * [StateFlow], mutates it from its own ticker (daemon-originated changes) and
 * from platform events pushed by the UI process (client-originated changes).
 */
data class DemoRuntimeState(
    val revision: Long = 1,
    val tickCount: Long = 0,
    val frontmostApp: String = "unknown",
    val platformEventCount: Int = 0,
)

class DemoRuntime(
    scope: CoroutineScope,
    tickPeriod: Duration = 1.seconds,
) {
    private val _state = MutableStateFlow(DemoRuntimeState())
    val state: StateFlow<DemoRuntimeState> = _state.asStateFlow()

    init {
        scope.launch {
            while (isActive) {
                delay(tickPeriod)
                _state.update {
                    it.copy(revision = it.revision + 1, tickCount = it.tickCount + 1)
                }
            }
        }
    }

    fun onFrontmostAppChanged(appId: String) {
        _state.update {
            it.copy(
                revision = it.revision + 1,
                frontmostApp = appId,
                platformEventCount = it.platformEventCount + 1,
            )
        }
    }
}
