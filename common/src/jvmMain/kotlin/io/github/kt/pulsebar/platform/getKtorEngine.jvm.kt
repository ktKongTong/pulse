package io.github.kt.pulsebar.platform

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.plugins.websocket.WebSockets

internal actual fun getHttpClient(): HttpClient = HttpClient(getKtorEngineFactory()) { install(WebSockets) }

internal actual fun getKtorEngineFactory(): HttpClientEngineFactory<HttpClientEngineConfig> {
    TODO()
}