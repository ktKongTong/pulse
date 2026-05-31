package io.github.kt.pulsebar.model

import io.github.kt.pulsebar.model.stream.MediaFlowState


data class FocusState(
    val name: String,
    val id: String,
    val startedAt: Long? = null,
    val lastActiveAt: Long? = null,
)

data class RuntimeState(
    val focusState: FocusState? = null,
    val mediaState: MediaFlowState? = null,
)
