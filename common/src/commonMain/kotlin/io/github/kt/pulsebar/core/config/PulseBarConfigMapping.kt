package io.github.kt.pulsebar.core.config

import io.github.kt.pulsebar.export.PulseBarConfig
import io.github.kt.pulsebar.export.PulseBarEndpointConfig
import io.github.kt.pulsebar.export.PulseBarInteractionExecutionMode
import io.github.kt.pulsebar.export.PulseBarInteractionPlaybackMode
import io.github.kt.pulsebar.export.PulseBarTransport

internal fun PulseBarConfigProto.toExport(): PulseBarConfig =
    PulseBarConfig(
        endpoints = endpoints.map { it.toExport() },
        idleThresholdSeconds = idleThresholdSeconds,
        changeStabilityMillis = changeStabilityMillis,
        heartbeatSeconds = heartbeatSeconds,
        appPollingMillis = appPollingMillis,
        pagePollingMillis = pagePollingMillis,
        mediaPollingMillis = mediaPollingMillis,
        allowWebInteractions = allowWebInteractions,
        interactionExecutionMode = interactionExecutionMode.toExport(),
        interactionExecutionModeName = interactionExecutionMode.name,
        interactionPlaybackMode = interactionPlaybackMode.toExport(),
        interactionPlaybackModeName = interactionPlaybackMode.name,
    )

internal fun EndpointProto.toExport(): PulseBarEndpointConfig =
    PulseBarEndpointConfig(
        id = id,
        name = name,
        enabled = enabled,
        disconnected = disconnected,
        transport = transport.toExport(),
        transportName = transport.name,
        endpointUrl = endpointUrl,
        workspaceId = workspaceId,
        siteId = siteId,
        apiKey = apiKey,
        batchWindowSeconds = batchWindowSeconds,
    )

internal fun TransportProto.toExport(): PulseBarTransport =
    when (this) {
        TransportProto.WEBSOCKET -> PulseBarTransport.WEBSOCKET
        TransportProto.WEBHOOK -> PulseBarTransport.WEBHOOK
        TransportProto.HTTP_BATCH -> PulseBarTransport.HTTP_BATCH
    }

internal fun InteractionExecutionModeProto.toExport(): PulseBarInteractionExecutionMode =
    when (this) {
        InteractionExecutionModeProto.CONFIRM -> PulseBarInteractionExecutionMode.CONFIRM
        InteractionExecutionModeProto.AUTO_ENQUEUE -> PulseBarInteractionExecutionMode.AUTO_ENQUEUE
    }

internal fun InteractionPlaybackModeProto.toExport(): PulseBarInteractionPlaybackMode =
    when (this) {
        InteractionPlaybackModeProto.PLAY_NOW -> PulseBarInteractionPlaybackMode.PLAY_NOW
        InteractionPlaybackModeProto.PLAY_NEXT -> PulseBarInteractionPlaybackMode.PLAY_NEXT
    }

internal fun PulseBarConfig.toProto(): PulseBarConfigProto =
    PulseBarConfigProto(
        endpoints = endpoints.map { it.toProto() }.ifEmpty { listOf(EndpointProto.default()) },
        idleThresholdSeconds = idleThresholdSeconds,
        changeStabilityMillis = changeStabilityMillis,
        heartbeatSeconds = heartbeatSeconds,
        appPollingMillis = appPollingMillis,
        pagePollingMillis = pagePollingMillis,
        mediaPollingMillis = mediaPollingMillis,
        allowWebInteractions = allowWebInteractions,
        interactionExecutionMode = interactionExecutionMode.toProto(),
        interactionPlaybackMode = interactionPlaybackMode.toProto(),
    )

internal fun PulseBarEndpointConfig.toProto(): EndpointProto =
    EndpointProto(
        id = id.ifBlank { endpointUrl.ifBlank { EndpointProto.DEFAULT_ID } },
        name = name.ifBlank { EndpointProto.DEFAULT_NAME },
        enabled = enabled,
        disconnected = disconnected,
        transport = transport.toProto(),
        endpointUrl = endpointUrl,
        workspaceId = workspaceId,
        siteId = siteId,
        apiKey = apiKey,
        batchWindowSeconds = batchWindowSeconds.coerceAtLeast(1),
    )

internal fun PulseBarTransport.toProto(): TransportProto =
    when (this) {
        PulseBarTransport.WEBSOCKET -> TransportProto.WEBSOCKET
        PulseBarTransport.WEBHOOK -> TransportProto.WEBHOOK
        PulseBarTransport.HTTP_BATCH -> TransportProto.HTTP_BATCH
    }

internal fun PulseBarInteractionExecutionMode.toProto(): InteractionExecutionModeProto =
    when (this) {
        PulseBarInteractionExecutionMode.CONFIRM -> InteractionExecutionModeProto.CONFIRM
        PulseBarInteractionExecutionMode.AUTO_ENQUEUE -> InteractionExecutionModeProto.AUTO_ENQUEUE
    }

internal fun PulseBarInteractionPlaybackMode.toProto(): InteractionPlaybackModeProto =
    when (this) {
        PulseBarInteractionPlaybackMode.PLAY_NOW -> InteractionPlaybackModeProto.PLAY_NOW
        PulseBarInteractionPlaybackMode.PLAY_NEXT -> InteractionPlaybackModeProto.PLAY_NEXT
    }
