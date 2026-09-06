package io.github.kt.pulsebar.flowipc

import io.github.kt.pulsebar.flowipc.v1.FlowBridgeDemoGrpcKt
import io.github.kt.pulsebar.flowipc.v1.RuntimeState
import io.github.kt.pulsebar.flowipc.v1.WatchRuntimeStateRequest
import io.github.kt.pulsebar.flowipc.v1.frontmostAppChanged
import io.github.kt.pulsebar.flowipc.v1.platformEvent
import io.grpc.ManagedChannelBuilder
import io.grpc.Server
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.InetSocketAddress
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds

/**
 * Validates the Flow semantics of the dual-process plan over a real loopback
 * gRPC socket (grpc-kotlin server + grpc-kotlin client standing in for the
 * .NET client; the wire behavior is identical for Grpc.Net.Client):
 *
 * 1. Snapshot-first: a new subscriber's first item is the current state.
 * 2. Upstream client stream arrives in Kotlin as a plain Flow.
 * 3. Round trip: client events mutate daemon state, which flows back down.
 * 4. Client cancellation propagates into the server-side Flow.
 */
class FlowBridgeDemoServerTest {

    @Test
    fun flowSemanticsSurviveTheGrpcBoundary(): Unit = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val runtime = DemoRuntime(scope, tickPeriod = 50.milliseconds)
        val watchCompletions = Channel<Throwable?>(Channel.UNLIMITED)
        val server: Server = NettyServerBuilder
            .forAddress(InetSocketAddress("127.0.0.1", 0))
            .addService(FlowBridgeDemoService(runtime) { cause -> watchCompletions.trySend(cause) })
            .build()
            .start()
        val channel = ManagedChannelBuilder
            .forAddress("127.0.0.1", server.port)
            .usePlaintext()
            .build()
        val stub = FlowBridgeDemoGrpcKt.FlowBridgeDemoCoroutineStub(channel)
        val request = WatchRuntimeStateRequest.getDefaultInstance()

        try {
            // 1. Snapshot-first on a fresh daemon.
            val first = withTimeout(5_000) { stub.watchRuntimeState(request).first() }
            assertEquals("unknown", first.frontmostApp)
            assertEquals(0, first.platformEventCount)

            // 2. Upstream events consumed as Flow<PlatformEvent> on the server.
            val apps = listOf("com.microsoft.vscode", "org.mozilla.firefox", "com.jetbrains.rider")
            val summary = withTimeout(5_000) {
                stub.publishPlatformEvents(
                    flowOf(*apps.map { app ->
                        platformEvent { frontmostAppChanged = frontmostAppChanged { appId = app } }
                    }.toTypedArray()),
                )
            }
            assertEquals(apps.size, summary.acceptedEvents)

            // 3. Round trip: the mutation is observable through the watch stream.
            withTimeout(5_000) {
                stub.watchRuntimeState(request).first {
                    it.frontmostApp == apps.last() && it.platformEventCount == apps.size
                }
            }

            // 1b. Snapshot-first after mutations: a *new* subscriber's first
            // item already carries the latest state (StateFlow replay semantics
            // made explicit in the contract).
            val fresh = withTimeout(5_000) { stub.watchRuntimeState(request).first() }
            assertEquals(apps.last(), fresh.frontmostApp)
            assertEquals(apps.size, fresh.platformEventCount)

            // 4. Client cancellation reaches the server-side Flow.
            while (watchCompletions.tryReceive().isSuccess) {
                // Drain completions caused by the .first() subscriptions above.
            }
            val received = Channel<RuntimeState>(Channel.UNLIMITED)
            val watcher = launch {
                stub.watchRuntimeState(request).collect { received.send(it) }
            }
            withTimeout(5_000) { received.receive() }
            watcher.cancel()
            watcher.join()
            val cause = withTimeout(5_000) { watchCompletions.receive() }
            assertTrue(
                cause is CancellationException,
                "expected server-side CancellationException, got $cause",
            )
        } finally {
            channel.shutdownNow()
            server.shutdownNow()
            server.awaitTermination(5, TimeUnit.SECONDS)
            scope.cancel()
        }
    }
}
