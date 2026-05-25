package io.github.kt.pulsebar.core.stream

/**
 * Connection parameters for a single Stream session. The Swift layer
 * derived this from `StreamEndpointConfig`; now it's a plain data class
 * in shared code.
 */
data class StreamConnectionConfig(
    val roomId: String,
    val deviceId: String,
    val baseUrl: String,
    val workspaceId: String,
    val apiKey: String,
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
)
