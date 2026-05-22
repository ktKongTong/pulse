package io.github.kt.pulsebar.core.devicev2

import kotlinx.serialization.json.Json

internal val deviceV2Json: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

