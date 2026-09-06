package io.github.kt.pulsebar.export.event

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.utils.nowInMillis

data class ConnectCommand(
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor() : this(sentAt = nowInMillis())
}

data class DisconnectCommand(
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor() : this(sentAt = nowInMillis())
}

data class SetEndpointEnabledCommand(
    val enabled: Boolean,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(enabled: Boolean) : this(
        enabled = enabled,
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

data class UpdateConfigCommand(
    val config: PulseConfig,
    val sentAt: Long = nowInMillis(),
) : AppEvent {
    constructor(config: PulseConfig) : this(
        config = config,
        sentAt = nowInMillis(),
    )
}
