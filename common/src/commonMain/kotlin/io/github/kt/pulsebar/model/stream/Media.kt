package io.github.kt.pulsebar.model.stream

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Media(
    val providerId: String? = null,
    val itemType: String? = null,
    val trackId: String? = null,
    val uri: String? = null,
    val linkUrl: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val progressSeconds: Double = 0.0,
    val durationSeconds: Double? = null,
    val trackNumber: Int? = null,
    val discNumber: Int? = null,
    val collectionId: String? = null,
    val collectionTitle: String? = null,
    val collectionLinkUrl: String? = null,
    val playbackStatus: PlaybackStatus = PlaybackStatus.PAUSED,
)

@Serializable
enum class PlaybackStatus {
    @SerialName("playing") PLAYING,
    @SerialName("paused") PAUSED,
}


@Serializable
enum class StreamPermission {
    @SerialName("allow") ALLOW,
    @SerialName("disallow") DISALLOW,
}

@Serializable
enum class StreamCaptureStatus {
    @SerialName("capturing") CAPTURING,
    @SerialName("no-capture") IDLE,
}
