package io.github.kt.pulsebar.export.ui

import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.StreamState
import kotlinx.serialization.Serializable

@Serializable
data class InitialMediaState(
    val streamState: StreamState,
    val media: Media?,
)
