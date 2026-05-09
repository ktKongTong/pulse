package io.github.kt.pulsebar.core.config

import androidx.datastore.core.okio.OkioSerializer
import co.touchlab.kermit.Logger
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okio.BufferedSink
import okio.BufferedSource
import okio.use

/**
 * On-disk format: pretty-printed JSON of [PulseBarConfigProto].
 *
 * Corruption recovery: if the file can't be parsed (truncation, hand-edit,
 * old-shape JSON from a previous version), we log the failure and fall back
 * to [defaultValue]. Phase 1 retired the legacy `~/Library/Application
 * Support/PulseBar/config.json` path, so no legacy migration happens here.
 */
internal class PulseBarConfigSerializer(
    private val json: Json = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    },
    private val log: Logger = logger(PulseLogCategory.ConfigStore),
) : OkioSerializer<PulseBarConfigProto> {

    override val defaultValue: PulseBarConfigProto = PulseBarConfigProto()

    override suspend fun readFrom(source: BufferedSource): PulseBarConfigProto {
        val text = source.use { it.readUtf8() }
        if (text.isBlank()) return defaultValue
        return try {
            json.decodeFromString(PulseBarConfigProto.serializer(), text)
        } catch (error: SerializationException) {
            log.w(error) {
                "config.deserialize.failed recovering_with_defaults bytes=${text.length}"
            }
            defaultValue
        }
    }

    override suspend fun writeTo(t: PulseBarConfigProto, sink: BufferedSink) {
        sink.use { output ->
            output.writeUtf8(json.encodeToString(PulseBarConfigProto.serializer(), t))
        }
    }
}
