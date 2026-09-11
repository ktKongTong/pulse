package io.github.kt.pulsebar.desktopipc

import io.github.kt.pulsebar.desktopipc.v1.DesktopRuntimeGrpcKt
import io.github.kt.pulsebar.desktopipc.v1.PlatformEvent
import io.github.kt.pulsebar.desktopipc.v1.PublishSummary
import io.github.kt.pulsebar.desktopipc.v1.RuntimeStateSnapshot
import io.github.kt.pulsebar.desktopipc.v1.WatchRequest
import io.github.kt.pulsebar.desktopipc.v1.publishSummary
import io.github.kt.pulsebar.desktopipc.v1.runtimeStateSnapshot
import io.github.kt.pulsebar.flowipc.DemoRuntime
import io.grpc.Status
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart

/**
 * The first formal desktop IPC adapter. It intentionally depends on the demo
 * runtime so the wire contract can be tested before the full JVM bridge is
 * ready. The production replacement will hold the same shape around
 * PulseBarBridge.
 */
class DesktopRuntimeService(
    private val runtime: DemoRuntime,
    private val authToken: String,
    private val onWatchCompleted: (Throwable?) -> Unit = {},
) : DesktopRuntimeGrpcKt.DesktopRuntimeCoroutineImplBase() {

    override fun watchRuntimeState(request: WatchRequest): Flow<RuntimeStateSnapshot> {
        requireToken(request.authToken)
        return runtime.state
            .map { it.toSnapshot() }
            .onStart { log("watch: subscriber attached protocol=${request.protocolVersion}") }
            .onCompletion { cause ->
                log(
                    "watch: subscriber detached (" +
                        (cause?.let { "cause=${it::class.simpleName}" } ?: "completed") +
                        ")"
                )
                onWatchCompleted(cause)
            }
    }

    override suspend fun publishPlatformEvents(
        requests: Flow<PlatformEvent>,
    ): PublishSummary {
        var accepted = 0
        requests.collect { event ->
            requireToken(event.authToken)
            when (event.eventCase) {
                PlatformEvent.EventCase.FRONTMOST_APP_CHANGED -> {
                    runtime.onFrontmostAppChanged(event.frontmostAppChanged.appId)
                    accepted += 1
                    log("publish: frontmostAppChanged -> ${event.frontmostAppChanged.appId}")
                }
                PlatformEvent.EventCase.EVENT_NOT_SET ->
                    log("publish: ignoring event without a known case")
            }
        }

        return publishSummary { acceptedEvents = accepted }
    }

    private fun requireToken(token: String) {
        if (token != authToken) {
            throw Status.UNAUTHENTICATED
                .withDescription("Invalid desktop IPC auth token")
                .asRuntimeException()
        }
    }

    private fun log(message: String) = println("[desktop-daemon] $message")
}

private fun io.github.kt.pulsebar.flowipc.DemoRuntimeState.toSnapshot(): RuntimeStateSnapshot =
    runtimeStateSnapshot {
        revision = this@toSnapshot.revision
        tickCount = this@toSnapshot.tickCount
        frontmostApp = this@toSnapshot.frontmostApp
        platformEventCount = this@toSnapshot.platformEventCount
    }
