package io.github.kt.pulsebar.flowipc

import io.github.kt.pulsebar.desktopipc.RealDesktopRuntimeService
import io.github.kt.pulsebar.export.PulseBarBridge
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
import java.net.InetSocketAddress
import java.util.UUID

const val DESKTOP_IPC_PROTOCOL = "desktop-ipc-v1"

fun main() {
    val bridge = PulseBarBridge(initialMedia = null)
    val authToken = UUID.randomUUID().toString()
    val server = NettyServerBuilder
        .forAddress(InetSocketAddress("127.0.0.1", 0))
        .addService(RealDesktopRuntimeService(bridge, authToken))
        .build()
        .start()

    println("[daemon] PulseBarBridge + DesktopRuntime listening on 127.0.0.1:${server.port}")
    println("PULSEBAR_DAEMON_READY port=${server.port} token=$authToken protocol=$DESKTOP_IPC_PROTOCOL")
    Runtime.getRuntime().addShutdownHook(
        Thread {
            server.shutdownNow()
        },
    )
    server.awaitTermination()
}
