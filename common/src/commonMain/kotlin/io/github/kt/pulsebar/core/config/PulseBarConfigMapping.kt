package io.github.kt.pulsebar.core.config

import io.github.kt.pulsebar.export.PulseBarConfig
import io.github.kt.pulsebar.export.PulseBarEndpointConfig
import io.github.kt.pulsebar.export.PulseBarInteractionExecutionMode
import io.github.kt.pulsebar.export.PulseBarInteractionPlaybackMode

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
        endpointUrl = endpointUrl,
        workspaceId = workspaceId,
        siteId = siteId,
        apiKey = apiKey,
        batchWindowSeconds = batchWindowSeconds,
    )


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
    )

internal fun PulseBarEndpointConfig.toProto(): EndpointProto =
    EndpointProto(
        id = id.ifBlank { endpointUrl.ifBlank { EndpointProto.DEFAULT_ID } },
        name = name.ifBlank { EndpointProto.DEFAULT_NAME },
        enabled = enabled,
        endpointUrl = endpointUrl,
        workspaceId = workspaceId,
        siteId = siteId,
        apiKey = apiKey,
        batchWindowSeconds = batchWindowSeconds.coerceAtLeast(1),
    )

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
