package io.github.kt.pulsebar.export.ui

import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.StreamState
import kotlin.time.Duration
import kotlinx.serialization.Serializable

@Serializable
data class InitialMediaState(
    val streamState: StreamState,
    val media: Media? = null,
    val chunkDuration: Duration,
    val chunkBytes: Int,
)