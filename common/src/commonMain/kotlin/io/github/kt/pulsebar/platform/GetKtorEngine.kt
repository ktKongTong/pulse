package io.github.kt.pulsebar.platform
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory

internal expect fun getKtorEngineFactory(): HttpClientEngineFactory<HttpClientEngineConfig>
internal expect fun getHttpClient(): HttpClient
