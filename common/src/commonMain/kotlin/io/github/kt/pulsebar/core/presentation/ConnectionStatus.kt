package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarEndpointConfig
import io.github.kt.pulsebar.export.PulseBarEndpointDraft
import io.github.kt.pulsebar.export.PulseBarEndpointSyncState

/**
 * Three-state projection of an endpoint as the UI wants to show it.
 *
 * The raw [PulseBarEndpointSyncState] has ~10 sub-states; UIs universally
 * collapse these into `connected / disconnected / reconnecting`. This
 * derivation used to live in Swift (`ConnectionRuntimeStatus.resolve`) and
 * is now shared so a future Windows shell or a unit test doesn't have to
 * reimplement it.
 */
enum class ConnectionRuntimeStatus(val title: String) {
    Connected("connected"),
    Disconnected("disconnected"),
    Reconnecting("reconnecting"),
}

/**
 * Collapses the endpoint + its current sync state into a
 * [ConnectionRuntimeStatus]. [manuallyDisconnected] reflects "user clicked
 * Disconnect but the row is still enabled" — a transient intent that the
 * UI has already applied optimistically.
 */
fun resolveConnectionStatus(
    endpoint: PulseBarEndpointConfig,
    sync: PulseBarEndpointSyncState?,
    manuallyDisconnected: Boolean,
): ConnectionRuntimeStatus = resolveConnectionStatusRaw(
    enabled = endpoint.enabled,
    endpointUrl = endpoint.endpointUrl,
    sync = sync,
    manuallyDisconnected = manuallyDisconnected,
)

/**
 * Draft-based variant used by the Swift Settings UI, which edits drafts
 * rather than configs. Same logic as the [PulseBarEndpointConfig] form —
 * named separately because Swift Export doesn't disambiguate Kotlin
 * top-level overloads.
 */
fun resolveDraftConnectionStatus(
    endpoint: PulseBarEndpointDraft,
    sync: PulseBarEndpointSyncState?,
    manuallyDisconnected: Boolean,
): ConnectionRuntimeStatus = resolveConnectionStatusRaw(
    enabled = endpoint.enabled,
    endpointUrl = endpoint.endpointUrl,
    sync = sync,
    manuallyDisconnected = manuallyDisconnected,
)

private fun resolveConnectionStatusRaw(
    enabled: Boolean,
    endpointUrl: String,
    sync: PulseBarEndpointSyncState?,
    manuallyDisconnected: Boolean,
): ConnectionRuntimeStatus {
    if (manuallyDisconnected || !enabled) {
        return ConnectionRuntimeStatus.Disconnected
    }
    if (sync == null) {
        return if (endpointUrl.trim().isEmpty()) {
            ConnectionRuntimeStatus.Disconnected
        } else {
            ConnectionRuntimeStatus.Reconnecting
        }
    }
    val status = sync.status
    val lastStatus = sync.lastStatus
    if (status == "disabled" ||
        status == "disconnected" ||
        lastStatus == "skip:endpoint_disabled" ||
        lastStatus == "skip:endpoint_disconnected"
    ) {
        return ConnectionRuntimeStatus.Reconnecting
    }
    return when (status) {
        "healthy" -> ConnectionRuntimeStatus.Connected
        "probing", "checking_server", "idle" -> ConnectionRuntimeStatus.Reconnecting
        else -> ConnectionRuntimeStatus.Disconnected
    }
}
