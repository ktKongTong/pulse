package io.github.kt.pulsebar.model

import kotlinx.serialization.Serializable


data class Endpoint(
    val siteId: String,
    val url: String,
    val workspaceId: String,
    val apiKey: String,
)

@Serializable
data class EndpointConfig(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val url: String,
    val siteId: String,
    val workspaceId: String,
    val apiKey: String,
)

fun EndpointConfig.getEndpoint() = Endpoint(
    siteId = siteId,
    url = url,
    apiKey = apiKey,
    workspaceId = workspaceId,
)
