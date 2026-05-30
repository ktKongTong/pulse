package io.github.kt.pulsebar.store.config

import io.github.kt.pulsebar.model.PulseConfig
import kotlinx.serialization.Serializable

@Serializable
internal data class PulseBarConfigProto(
    val schemaVersion: Int = SCHEMA_VERSION,
    val data: PulseConfig,
) {
    companion object {
        const val SCHEMA_VERSION: Int = 1
    }
}