package io.github.kt.pulsebar.flowipc

import io.github.kt.pulsebar.flowipc.v1.FlowBridgeDemoGrpcKt
import io.github.kt.pulsebar.flowipc.v1.PlatformEvent
import io.github.kt.pulsebar.flowipc.v1.PublishSummary
import io.github.kt.pulsebar.flowipc.v1.RuntimeState
import io.github.kt.pulsebar.flowipc.v1.WatchRuntimeStateRequest
import io.github.kt.pulsebar.flowipc.v1.publishSummary
import io.github.kt.pulsebar.flowipc.v1.runtimeState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart

/**
 * The gRPC edge of the demo daemon.
 *
 * Note how thin this is: the downstream RPC literally returns the runtime's
 * StateFlow (mapped to wire types), and the upstream RPC receives the client
 * stream as a plain Flow. No hand-written pump loops on the Kotlin side.
 *
 * [onWatchCompleted] exists so tests can assert that a client-side
 * cancellation propagates into the server-side Flow as a CancellationException.
 */
class FlowBridgeDemoService(
    private val runtime: DemoRuntime,
    private val onWatchCompleted: (Throwable?) -> Unit = {},
) : FlowBridgeDemoGrpcKt.FlowBridgeDemoCoroutineImplBase() {

    override fun watchRuntimeState(request: WatchRuntimeStateRequest): Flow<RuntimeState> =
        runtime.state
            .map { it.toProto() }
            .onStart { log("watch: subscriber attached") }
            .onCompletion { cause ->
                log("watch: subscriber detached (${cause?.let { "cause=${it::class.simpleName}" } ?: "completed"})")
                onWatchCompleted(cause)
            }

    override suspend fun publishPlatformEvents(requests: Flow<PlatformEvent>): PublishSummary {
        var accepted = 0
        requests.collect { event ->
            when (event.eventCase) {
                PlatformEvent.EventCase.FRONTMOST_APP_CHANGED -> {
                    runtime.onFrontmostAppChanged(event.frontmostAppChanged.appId)
                    accepted += 1
                    log("publish: frontmostAppChanged -> ${event.frontmostAppChanged.appId}")
                }
                else -> log("publish: ignoring event without a known case")
            }
        }
        log("publish: client completed the stream after $accepted events")
        return publishSummary { acceptedEvents = accepted }
    }

    private fun log(message: String) = println("[daemon] $message")
}

private fun DemoRuntimeState.toProto(): RuntimeState = runtimeState {
    revision = this@toProto.revision
    tickCount = this@toProto.tickCount
    frontmostApp = this@toProto.frontmostApp
    platformEventCount = this@toProto.platformEventCount
}
