package io.github.kt.pulsebar.export.event

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.utils.nowInMillis

data class ConnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class EnableEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class DisableEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class DisconnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class ReconnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class NativeNetworkChanged(
    val online: Boolean,
    val expensive: Boolean,
    val constrained: Boolean,
    val observedAtMillis: Long = nowInMillis(),
) : AppEvent {
    constructor(
        online: Boolean,
        expensive: Boolean,
        constrained: Boolean,
    ) : this(
        online = online,
        expensive = expensive,
        constrained = constrained,
        observedAtMillis = nowInMillis(),
    )
}

data class RemoveEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(endpointId: String) : this(
        endpointId = endpointId,
        sentAt = nowInMillis(),
    )
}

data class UpdateConfigCommand(
    val config: PulseConfig,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(config: PulseConfig) : this(
        config = config,
        sentAt = nowInMillis(),
    )
}
