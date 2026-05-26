package io.github.kt.pulsebar.evt


data class FocusSate(
    val name: String,
    val id: String,
    val startedAt: Long? = null,
    val lastActiveAt: Long? = null,
)

data class MediaState(
    val name: String,
)

data class ConnectionState(
    val name: String,
    val id: String,
)

data class RuntimeState(
    val focusSate: FocusSate? = null,
)