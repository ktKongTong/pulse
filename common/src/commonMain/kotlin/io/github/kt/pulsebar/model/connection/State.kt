package io.github.kt.pulsebar.model.connection

import io.github.kt.pulsebar.model.EndpointConfig
import io.github.kt.pulsebar.ws.connection.DeviceWsState

data class ConnectionState(
    val endpointConfig: EndpointConfig,
    val connection: DeviceWsState,
)