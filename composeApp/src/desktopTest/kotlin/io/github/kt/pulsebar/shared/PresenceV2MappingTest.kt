package io.github.kt.pulsebar.shared

import io.github.kt.pulsebar.presence.MediaPlaybackScope
import io.github.kt.pulsebar.presence.MediaPlaybackState
import io.github.kt.pulsebar.presence.PRESENCE_PROTOCOL_V2
import io.github.kt.pulsebar.presence.PresenceAvailabilityState
import io.github.kt.pulsebar.presence.PresenceEventKind
import io.github.kt.pulsebar.presence.PresenceKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.datetime.Instant

class PresenceV2MappingTest {
    private val now = Instant.parse("2026-04-02T12:00:00Z")

    @Test
    fun `status changed maps to v2 snapshot with generic media session`() {
        val envelope = ActivityEnvelope(
            sequence = 42,
            eventType = ActivityEventType.STATUS_CHANGED,
            sentAt = now,
            stableSince = now,
            stableForSeconds = 0,
            client = ClientIdentity(
                deviceName = "kt-macbook",
                platform = "macOS",
                appVersion = "2.0.0"
            ),
            snapshot = ActivitySnapshot(
                observedAt = now,
                focus = FocusTarget(
                    appName = "Safari",
                    bundleId = "com.apple.Safari",
                    page = PageContext(
                        title = "Example",
                        url = "https://example.com"
                    )
                ),
                presence = PresenceState.ACTIVE,
                idleSeconds = 3,
                media = MediaContext(
                    source = "Spotify",
                    state = "playing",
                    scope = MediaPlaybackScope.LOCAL,
                    title = "Track",
                    artist = "Artist",
                    album = "Album",
                    trackId = "spotify:track:123",
                    linkUrl = "https://open.spotify.com/track/123",
                    artworkUrl = "https://i.scdn.co/image/abc",
                    progressSeconds = 12.5,
                    durationSeconds = 180
                )
            )
        )

        val request = envelope.toPresenceIngestRequest(
            workspaceId = "workspace-a",
            deviceId = "macos-kt-macbook",
            sessionId = "session-a"
        )

        assertEquals(PRESENCE_PROTOCOL_V2, request.protocol)
        assertEquals("workspace-a", request.workspaceId)
        assertEquals("macos-kt-macbook", request.deviceId)
        assertEquals("session-a", request.sessionId)
        assertEquals(1, request.events.size)

        val event = request.events.single()
        assertEquals("macos-kt-macbook:42", event.eventId)
        assertEquals(PresenceEventKind.SNAPSHOT, event.kind)

        val state = assertNotNull(event.state)
        assertEquals(PresenceAvailabilityState.ACTIVE, state.availability.state)
        assertEquals(PresenceKind.INTERACTIVE, state.presenceKind)
        assertEquals("com.apple.Safari", state.focus.app?.id)
        assertEquals("https://example.com", state.focus.page?.url)

        val media = state.mediaSessions.single()
        assertEquals("spotify", media.provider.id)
        assertEquals(MediaPlaybackState.PLAYING, media.playback.state)
        assertEquals(MediaPlaybackScope.LOCAL, media.playback.scope)
        assertEquals("Track", media.item.title)
    }

    @Test
    fun `session ended maps to null state`() {
        val envelope = ActivityEnvelope(
            sequence = 7,
            eventType = ActivityEventType.SESSION_ENDED,
            sentAt = now,
            stableSince = now,
            stableForSeconds = 99,
            client = ClientIdentity(deviceName = "box", platform = "Linux"),
            snapshot = ActivitySnapshot(
                observedAt = now,
                focus = FocusTarget(
                    appName = "Code",
                    bundleId = "com.microsoft.VSCode"
                ),
                presence = PresenceState.ACTIVE,
                idleSeconds = 0
            )
        )

        val event = envelope.toPresenceEvent("linux-box")

        assertEquals(PresenceEventKind.SESSION_END, event.kind)
        assertNull(event.state)
    }

    @Test
    fun `away and loginwindow snapshots do not aggregate into usage`() {
        val away = ActivitySnapshot(
            observedAt = now,
            focus = FocusTarget(
                appName = "Safari",
                bundleId = "com.apple.Safari"
            ),
            presence = PresenceState.AWAY,
            idleSeconds = 800
        )
        val loginWindow = away.copy(
            focus = away.focus.copy(
                appName = "loginwindow",
                bundleId = "com.apple.loginwindow"
            ),
            presence = PresenceState.ACTIVE,
            idleSeconds = 0
        )

        assertFalse(away.shouldAggregateUsage())
        assertFalse(loginWindow.shouldAggregateUsage())
    }
}
