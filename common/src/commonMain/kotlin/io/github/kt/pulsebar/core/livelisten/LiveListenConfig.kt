package io.github.kt.pulsebar.core.livelisten

/**
 * Connection parameters for a single Live Listen session. The Swift layer
 * derived this from `LiveListenEndpointConfig`; now it's a plain data class
 * in shared code.
 */
data class LiveListenConnectionConfig(
    val roomId: String,
    val deviceId: String,
    val baseUrl: String,
    val workspaceId: String,
    val apiKey: String,
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
)
