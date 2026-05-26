package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarStreamConnectionState

/**
 * Inputs needed to derive the endpoint-row text the dashboard shows. This
 * is a platform-neutral shape — Swift maps `EndpointSyncStatusInfo` to
 * this, and any future Windows shell can too.
 *
 * Keeping the inputs/outputs primitive means the logic is directly
 * unit-testable in `:common:jvmTest`.
 */
data class EndpointRuntimeInput(
    val enabled: Boolean,
    val disconnected: Boolean,
    val endpointUrl: String,
    val isConnecting: Boolean,
    val status: String?,
    val lastStatus: String?,
    val lastErrorMessage: String?,
    val pendingCount: Int,
)

object EndpointPresentation {

    /** Swift's `connectionActionTitle`. */
    fun connectionActionTitle(input: EndpointRuntimeInput, status: PulseBarStreamConnectionState): String {
        if (input.isConnecting) return "Connecting…"
        return when (status) {
            PulseBarStreamConnectionState.CONNECTED -> "Disconnect"
            PulseBarStreamConnectionState.CONNECTING -> "Connecting…"
            PulseBarStreamConnectionState.RECONNECTING -> "Reconnect"
            PulseBarStreamConnectionState.STOPPING -> "Stopping…"
            PulseBarStreamConnectionState.FAILED -> "Reconnect"
            PulseBarStreamConnectionState.IDLE,
            PulseBarStreamConnectionState.STOPPED -> "Connect"
        }
    }

    /** Swift's `disconnectedReason`. Returns `"-"` when nothing to report. */
    fun disconnectedReason(input: EndpointRuntimeInput): String {
        if (input.isConnecting) return "-"
        if (!input.enabled) return "Endpoint disabled"
        if (input.disconnected) return "Disconnected manually"
        val status = input.status ?: return if (input.endpointUrl.isEmpty()) "Missing endpoint URL" else "-"
        if (isStaleInactive(status, input.lastStatus)) return "-"
        return when (status) {
            "healthy", "probing", "checking_server", "idle" -> "-"
            "local_unavailable" -> "Local server unavailable"
            "server_unavailable" -> "Server unavailable"
            "misconfigured", "configuration_error" -> "Configuration needs attention"
            else -> connectionStatusDetail(status, input.lastErrorMessage)
        }
    }

    /** Swift's `deliveryDetail`. */
    fun deliveryDetail(input: EndpointRuntimeInput): String {
        if (input.isConnecting) return "Connecting"
        if (!input.enabled) return "Endpoint disabled"
        if (input.disconnected) return "Disconnected manually"
        if (input.status != null && isStaleInactive(input.status, input.lastStatus)) return "Connecting"
        return deliveryStatusDetail(
            status = input.status,
            lastStatus = input.lastStatus,
            lastErrorMessage = input.lastErrorMessage,
            pendingCount = input.pendingCount,
        )
    }

    /** True when the sync row is disabled/disconnected — we want to hide error text. */
    fun isStaleInactive(status: String, lastStatus: String?): Boolean =
        status == "disabled" ||
            status == "disconnected" ||
            lastStatus == "skip:endpoint_disabled" ||
            lastStatus == "skip:endpoint_disconnected"

    /** Ported directly from Swift's top-level `connectionStatusDetail`. */
    fun connectionStatusDetail(status: String?, lastErrorMessage: String?): String {
        if (status == null) return "-"
        if (!lastErrorMessage.isNullOrEmpty()) return lastErrorMessage
        return when (status) {
            "local_unavailable" -> "Local server unavailable"
            "server_unavailable" -> "Server unavailable"
            "misconfigured", "configuration_error" -> "Configuration needs attention"
            "degraded" -> "Delivery degraded"
            else -> "-"
        }
    }

    /** Ported directly from Swift's top-level `deliveryStatusDetail`. */
    fun deliveryStatusDetail(
        status: String?,
        lastStatus: String?,
        lastErrorMessage: String?,
        pendingCount: Int,
    ): String {
        if (status == null) return "-"
        if (lastStatus != null) {
            when (lastStatus) {
                "skip:missing_workspace_site_or_api_key" -> return "Missing Workspace ID, Site ID, or API Key"
                "skip:endpoint_disabled" -> return "Endpoint disabled"
                "skip:no_change" -> return if (pendingCount > 0) "Waiting to deliver queued events" else "No new events"
                "replay:unauthorized" -> return "API Key is invalid"
                "replay:workspace_mismatch" -> return "Workspace ID does not match the server"
                "replay:site_mismatch" -> return "Site ID does not match the server"
                "replay:error" -> return lastErrorMessage ?: "Temporary delivery error"
                "replay:local_unavailable" -> return lastErrorMessage ?: "Local network unavailable"
                else -> {
                    if (lastStatus.startsWith("replay:ok:")) return "Events delivered successfully"
                    if (lastStatus.startsWith("replay:http:")) return lastErrorMessage ?: "Server rejected the ingest request"
                    if (lastStatus.startsWith("replay:attempt:")) return "Sending queued events"
                    // fall through to status-based detail
                }
            }
        }
        if (!lastErrorMessage.isNullOrEmpty()) return lastErrorMessage
        return when (status) {
            "healthy" -> if (pendingCount > 0) "Delivering queued events" else "Ready"
            "probing", "checking_server" -> "Checking server"
            "idle" -> if (pendingCount > 0) "Waiting for server check" else "Ready"
            "misconfigured", "configuration_error" -> "Endpoint configuration needs attention"
            "server_unavailable" -> "Server unavailable; new events stay in SQLite"
            "local_unavailable" -> "Local network unavailable"
            "disabled" -> "Endpoint disabled"
            "degraded" -> "Delivery degraded"
            else -> status.replace('_', ' ').replaceFirstChar { it.titlecase() }
        }
    }
}
