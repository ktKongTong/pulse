package io.github.kt.pulsebar.flowipc

import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.net.InetSocketAddress

/**
 * Loopback-only and unauthenticated on a fixed port: acceptable for a spike,
 * not for the real daemon. The real one should bind port 0 and hand the port
 * plus an auth token to the UI process during startup handshake.
 */
const val DEMO_DAEMON_PORT = 56180

fun main() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val runtime = DemoRuntime(scope)
    val server = NettyServerBuilder
        .forAddress(InetSocketAddress("127.0.0.1", DEMO_DAEMON_PORT))
        .addService(FlowBridgeDemoService(runtime))
        .build()
        .start()

    println("[daemon] FlowBridgeDemo listening on 127.0.0.1:$DEMO_DAEMON_PORT (Ctrl+C to stop)")
    Runtime.getRuntime().addShutdownHook(
        Thread {
            server.shutdownNow()
            scope.cancel()
        },
    )
    server.awaitTermination()
}
