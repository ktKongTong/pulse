package io.github.kt.pulsebar.shared

import io.github.kt.pulsebar.presence.MediaItem
import io.github.kt.pulsebar.presence.MediaItemType
import io.github.kt.pulsebar.presence.MediaPlayback
import io.github.kt.pulsebar.presence.MediaPlaybackState
import io.github.kt.pulsebar.presence.MediaProvider
import io.github.kt.pulsebar.presence.MediaProviderKind
import io.github.kt.pulsebar.presence.PresenceApp
import io.github.kt.pulsebar.presence.PresenceAvailability
import io.github.kt.pulsebar.presence.PresenceAvailabilityState
import io.github.kt.pulsebar.presence.PresenceCapabilities
import io.github.kt.pulsebar.presence.PresenceDevice
import io.github.kt.pulsebar.presence.PresenceEvent
import io.github.kt.pulsebar.presence.PresenceEventKind
import io.github.kt.pulsebar.presence.PresenceExtensions
import io.github.kt.pulsebar.presence.PresenceFocus
import io.github.kt.pulsebar.presence.PresenceFocusState
import io.github.kt.pulsebar.presence.PresenceIngestRequest
import io.github.kt.pulsebar.presence.PresenceKind
import io.github.kt.pulsebar.presence.PresenceMediaSession
import io.github.kt.pulsebar.presence.PresencePage
import io.github.kt.pulsebar.presence.PresencePlatform
import io.github.kt.pulsebar.presence.PresenceStatePayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

fun ActivityEnvelope.toPresenceIngestRequest(
    workspaceId: String,
    deviceId: String,
    sessionId: String
): PresenceIngestRequest =
    PresenceIngestRequest(
        workspaceId = workspaceId,
        deviceId = deviceId,
        sessionId = sessionId,
        events = listOf(toPresenceEvent(deviceId))
    )

fun ActivityEnvelope.toPresenceEvent(deviceId: String): PresenceEvent =
    PresenceEvent(
        eventId = "$deviceId:$sequence",
        seq = sequence,
        kind = eventType.toPresenceEventKind(),
        observedAt = snapshot.observedAt.toString(),
        sentAt = sentAt.toString(),
        state = if (eventType == ActivityEventType.SESSION_ENDED) {
            null
        } else {
            snapshot.toPresenceStatePayload(client)
        }
    )

fun ActivitySnapshot.toPresenceStatePayload(client: ClientIdentity): PresenceStatePayload {
    val mediaSessions = media?.let { listOf(it.toPresenceMediaSession()) } ?: emptyList()
    val availabilityState = when (presence) {
        PresenceState.ACTIVE -> PresenceAvailabilityState.ACTIVE
        PresenceState.AWAY -> PresenceAvailabilityState.IDLE
    }
    val focusState = when {
        focus.bundleId == "unknown" -> PresenceFocusState.NONE
        presence == PresenceState.AWAY && mediaSessions.isNotEmpty() -> PresenceFocusState.BACKGROUND
        else -> PresenceFocusState.FOREGROUND
    }

    return PresenceStatePayload(
        availability = PresenceAvailability(
            state = availabilityState,
            idleSeconds = idleSeconds.takeIf { it > 0 }
        ),
        focus = PresenceFocus(
            state = focusState,
            app = PresenceApp(
                name = focus.appName,
                id = focus.bundleId
            ),
            page = focus.page?.let { page ->
                PresencePage(
                    title = page.title,
                    url = page.url
                )
            }
        ),
        presenceKind = when {
            mediaSessions.any { it.playback.state == MediaPlaybackState.PLAYING } &&
                availabilityState != PresenceAvailabilityState.ACTIVE -> PresenceKind.MEDIA
            availabilityState != PresenceAvailabilityState.ACTIVE -> PresenceKind.PASSIVE
            mediaSessions.any { it.playback.state == MediaPlaybackState.PLAYING } &&
                focusState != PresenceFocusState.FOREGROUND -> PresenceKind.MEDIA
            else -> PresenceKind.INTERACTIVE
        },
        mediaSessions = mediaSessions,
        device = PresenceDevice(
            platform = client.toPresencePlatform(),
            appVersion = client.appVersion,
            deviceName = client.deviceName
        ),
        capabilities = PresenceCapabilities(
            focusApp = true,
            focusWindow = false,
            browserPage = true,
            mediaNowPlaying = true
        ),
        extensions = PresenceExtensions(
            platform = buildPlatformExtensions(),
            providers = buildProviderExtensions()
        ).orNullIfEmpty()
    )
}

private fun ActivityEventType.toPresenceEventKind(): PresenceEventKind =
    when (this) {
        ActivityEventType.STATUS_CHANGED -> PresenceEventKind.SNAPSHOT
        ActivityEventType.HEARTBEAT -> PresenceEventKind.HEARTBEAT
        ActivityEventType.SESSION_ENDED -> PresenceEventKind.SESSION_END
    }

private fun MediaContext.toPresenceMediaSession(): PresenceMediaSession {
    val providerId = normalizedProviderId()
    return PresenceMediaSession(
        provider = MediaProvider(
            id = providerId,
            kind = providerKind()
        ),
        item = MediaItem(
            type = itemType(),
            id = trackId,
            uri = linkUrl ?: trackId,
            title = title,
            artist = artist,
            album = album,
            artworkUrl = artworkUrl,
            linkUrl = linkUrl
        ),
        playback = MediaPlayback(
            state = playbackState(),
            progressSeconds = progressSeconds,
            durationSeconds = durationSeconds,
            scope = scope
        ),
        extensions = PresenceExtensions(
            providers = buildJsonObject {
                put(providerId, buildJsonObject {
                    albumArtist?.let { put("albumArtist", JsonPrimitive(it)) }
                    popularity?.let { put("popularity", JsonPrimitive(it)) }
                    trackNumber?.let { put("trackNumber", JsonPrimitive(it)) }
                    discNumber?.let { put("discNumber", JsonPrimitive(it)) }
                    if (source != providerId) {
                        put("sourceLabel", JsonPrimitive(source))
                    }
                })
            }.takeUnless { it.isEmpty() }
        ).orNullIfEmpty()
    )
}

private fun ClientIdentity.toPresencePlatform(): PresencePlatform =
    when (platform.lowercase()) {
        "macos", "macos 14+", "mac os", "darwin" -> PresencePlatform.MACOS
        "windows" -> PresencePlatform.WINDOWS
        "linux" -> PresencePlatform.LINUX
        else -> PresencePlatform.OTHER
    }

private fun ActivitySnapshot.buildPlatformExtensions(): JsonObject? =
    buildJsonObject {
        focus.pid?.let { put("pid", JsonPrimitive(it)) }
        focus.bundlePath?.let { put("bundlePath", JsonPrimitive(it)) }
        put("privacyMode", JsonPrimitive(focus.privacyMode.name.lowercase()))
    }.takeUnless { it.isEmpty() }

private fun ActivitySnapshot.buildProviderExtensions(): JsonObject? =
    media?.let {
        buildJsonObject {
            put(it.normalizedProviderId(), buildJsonObject {
                put("scope", JsonPrimitive(it.scope.name.lowercase()))
            })
        }
    }?.takeUnless { it.isEmpty() }

private fun MediaContext.normalizedProviderId(): String =
    source.trim()
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifBlank { "unknown" }

private fun MediaContext.providerKind(): MediaProviderKind =
    when (normalizedProviderId()) {
        "spotify", "music", "apple-music", "netease-music", "qq-music", "tencent-music" -> MediaProviderKind.MUSIC
        "youtube", "netflix", "vlc", "iina" -> MediaProviderKind.VIDEO
        else -> MediaProviderKind.OTHER
    }

private fun MediaContext.itemType(): MediaItemType =
    when {
        title != null || trackId != null -> MediaItemType.TRACK
        else -> MediaItemType.UNKNOWN
    }

private fun MediaContext.playbackState(): MediaPlaybackState =
    when (state.lowercase()) {
        "playing" -> MediaPlaybackState.PLAYING
        "paused" -> MediaPlaybackState.PAUSED
        else -> MediaPlaybackState.STOPPED
    }

private fun PresenceExtensions.orNullIfEmpty(): PresenceExtensions? =
    takeUnless { platform == null && providers == null }
