package io.github.kt.pulsebar.flowipc

import io.github.kt.pulsebar.desktopipc.DesktopRuntimeService
import io.github.kt.pulsebar.desktopipc.v1.DesktopRuntimeGrpcKt

import io.github.kt.pulsebar.desktopipc.v1.FrontmostAppChanged
import io.github.kt.pulsebar.desktopipc.v1.PlatformEvent
import io.github.kt.pulsebar.desktopipc.v1.WatchRequest
import io.grpc.ManagedChannelBuilder
import io.grpc.Server
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.InetSocketAddress
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds

class DesktopRuntimeServiceTest {

    @Test
    fun formalContractKeepsSnapshotAndEventRoundTrip(): Unit = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val runtime = DemoRuntime(scope, tickPeriod = 50.milliseconds)
        val authToken = "test-token"
        val token = authToken
        val server: Server = NettyServerBuilder
            .forAddress(InetSocketAddress("127.0.0.1", 0))
            .addService(DesktopRuntimeService(runtime, authToken))
            .build()
            .start()
        val channel = ManagedChannelBuilder
            .forAddress("127.0.0.1", server.port)
            .usePlaintext()
            .build()
        val stub = DesktopRuntimeGrpcKt.DesktopRuntimeCoroutineStub(channel)
        val request = WatchRequest.newBuilder()
                    .setProtocolVersion("desktop-ipc-v1")
                                .setAuthToken(authToken)
                    .build()

        try {
            val initial = withTimeout(5_000) {
                stub.watchRuntimeState(request).first()
            }
            assertEquals("unknown", initial.frontmostApp)
            assertEquals(0, initial.platformEventCount)

            val summary = withTimeout(5_000) {
                stub.publishPlatformEvents(
                    flowOf(
                        PlatformEvent.newBuilder()
                            .setAuthToken(token)
                            .setFrontmostAppChanged(
                                FrontmostAppChanged.newBuilder()
                                    .setAppId("pulsebar.windows.preview")
                                    .build(),
                            )
                            .build(),
                    ),
                )
            }
            assertEquals(1, summary.acceptedEvents)

            val updated = withTimeout(5_000) {
                stub.watchRuntimeState(request).first {
                    it.frontmostApp == "pulsebar.windows.preview"
                }
            }
            assertEquals(1, updated.platformEventCount)
        } finally {
            channel.shutdownNow()
            server.shutdownNow()
            server.awaitTermination(5, TimeUnit.SECONDS)
            scope.cancel()
        }
    }
}
