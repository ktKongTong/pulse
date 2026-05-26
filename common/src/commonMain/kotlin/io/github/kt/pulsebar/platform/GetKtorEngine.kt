package io.github.kt.pulsebar.platform
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineConfig
import io.ktor.client.engine.HttpClientEngineFactory
//import io.ktor.client.engine.darwin.Darwin
//fun getKtorEngine() = Darwin
//expect fun getKtorEngine():
//        HttpClientEngineFactory<HttpClientEngineConfig>

internal expect fun getHttpClient(): HttpClient
