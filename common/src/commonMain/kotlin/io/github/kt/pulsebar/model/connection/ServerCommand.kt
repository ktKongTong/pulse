package io.github.kt.pulsebar.model.connection

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class ServerStreamCommand(val commandId: String, val command: JsonObject, val type: ServerCommandType)

@Serializable
enum class ServerCommandType(val cmd: String) {
    StreamRequest("stream.requested"),
    StreamResume("stream.resume"),
    StreamStop("stream.stop"),
    ;
    companion object {
        private val byCmd: Map<String, ServerCommandType> =
            entries.associateBy(ServerCommandType::cmd)

        fun from(value: String): ServerCommandType? =
            byCmd[value]
    }
}