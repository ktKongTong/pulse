package io.github.kt.pulsebar.core.config

import kotlinx.serialization.Serializable

/**
 * Serialized shape of the PulseBar config file. This is the single source of
 * truth for how config is persisted; the `PulseBarConfig` type that crosses
 * Swift Export is derived from this.
 *
 * `schemaVersion` is bumped any time the on-disk shape changes in a way that
 * isn't directly compatible. Phase 2 starts at version 1; earlier legacy
 * shapes (`NSUserDefaults` + JSON blob) are not migrated.
 */
@Serializable
internal data class PulseBarConfigProto(
    val schemaVersion: Int = SCHEMA_VERSION,
    val endpoints: List<EndpointProto> = listOf(EndpointProto.default()),
    val idleThresholdSeconds: Int = 300,
    val changeStabilityMillis: Int = 1_200,
    val heartbeatSeconds: Int = 60,
    val appPollingMillis: Int = 500,
    val pagePollingMillis: Int = 2_000,
    val mediaPollingMillis: Int = 500,
    val allowWebInteractions: Boolean = true,
    val interactionExecutionMode: InteractionExecutionModeProto = InteractionExecutionModeProto.CONFIRM,
    val interactionPlaybackMode: InteractionPlaybackModeProto = InteractionPlaybackModeProto.PLAY_NEXT,
) {
    companion object {
        const val SCHEMA_VERSION: Int = 1
    }
}

@Serializable
internal data class EndpointProto(
    val id: String,
    val name: String,
    val enabled: Boolean = false,
    val disconnected: Boolean = false,
    val transport: TransportProto = TransportProto.WEBSOCKET,
    val endpointUrl: String = "",
    val workspaceId: String = "",
    val siteId: String = "",
    val apiKey: String = "",
    val batchWindowSeconds: Int = 15,
) {
    companion object {
        const val DEFAULT_ID: String = "default-endpoint"
        const val DEFAULT_NAME: String = "Primary endpoint"

        fun default(): EndpointProto = EndpointProto(id = DEFAULT_ID, name = DEFAULT_NAME)
    }
}

@Serializable
internal enum class TransportProto {
    WEBSOCKET,
    WEBHOOK,
    HTTP_BATCH,
}

@Serializable
internal enum class InteractionExecutionModeProto {
    CONFIRM,
    AUTO_ENQUEUE,
}

@Serializable
internal enum class InteractionPlaybackModeProto {
    PLAY_NOW,
    PLAY_NEXT,
}
