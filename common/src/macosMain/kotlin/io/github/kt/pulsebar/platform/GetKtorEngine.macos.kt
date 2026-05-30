package io.github.kt.pulsebar.platform

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.websocket.WebSockets

actual fun getKtorEngineFactory(): HttpClientEngineFactory<HttpClientEngineConfig> = Darwin

internal actual fun getHttpClient(): HttpClient {
   return HttpClient(Darwin) { install(WebSockets) }
}
