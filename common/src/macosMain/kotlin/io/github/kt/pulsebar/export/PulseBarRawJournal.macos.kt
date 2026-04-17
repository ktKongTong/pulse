package io.github.kt.pulsebar.export

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.coroutines.runBlocking
import platform.Foundation.NSUserDefaults

private const val DEVICE_RAW_RETENTION_MS = 7L * 24L * 60L * 60L * 1000L
private const val RAW_JOURNAL_KEY = "pulsebar.rawJournal.entries"
private const val RAW_CHECKPOINTS_KEY = "pulsebar.rawJournal.checkpoints"
private const val RAW_SEQUENCE_KEY = "pulsebar.rawJournal.sequence"
private const val ROOM_RAW_JOURNAL_MIGRATION_KEY = "pulsebar.migration.room.raw-journal-v1"
private const val ROOM_RAW_SEQUENCE_KEY = "raw_sequence"
private const val ROOM_RAW_JOURNAL_MAX_ENTRIES = 2048L

internal data class RawJournalEntry(
    val protocol: String,
    val endpointKey: String,
    val workspaceId: String,
    val deviceId: String,
    val sessionId: String,
    val eventId: String,
    val seq: Long,
    val observedAt: String,
    val sentAt: String,
    val kind: String,
    val event: JsonObject,
    val queuedAtMillis: Long
)

internal data class DeliveryWatermark(
    val endpointKey: String,
    val deviceId: String,
    val acknowledgedSeqMax: Long,
    val acknowledgedAtIso8601: String
)

internal data class ReplayBatchResult(
    val endpointKey: String,
    val batchSize: Int,
    val acknowledgedSeqMax: Long,
    val removedCount: Int
)

internal class PulseBarRawJournalStore {
    private val defaults = NSUserDefaults.standardUserDefaults
    private val json = PulseBarRoomProvider.json
    private val database get() = PulseBarRoomProvider.database
    private val dao get() = database.rawJournalDao()

    fun migrateToRoomIfNeeded() {
        if (defaults.boolForKey(ROOM_RAW_JOURNAL_MIGRATION_KEY)) return

        val rawEntries = defaults.stringForKey(RAW_JOURNAL_KEY)
        val rawCheckpoints = defaults.stringForKey(RAW_CHECKPOINTS_KEY)
        val rawSequence = defaults.integerForKey(RAW_SEQUENCE_KEY)

        runBlocking {
            rawEntries?.let { serialized ->
                runCatching {
                    json.parseToJsonElement(serialized).jsonArray.map { it.jsonObject.toRawJournalEntry() }
                }.getOrDefault(emptyList()).forEach { entry ->
                    dao.upsertRawJournalEntity(entry.toEntity(json))
                }
            }

            rawCheckpoints?.let { serialized ->
                runCatching {
                    json.parseToJsonElement(serialized).jsonArray.map { it.jsonObject.toDeliveryWatermark() }
                }.getOrDefault(emptyList()).forEach { checkpoint ->
                    dao.upsertCheckpoint(
                        DeliveryWatermarkEntity(
                            endpointKey = checkpoint.endpointKey,
                            deviceId = checkpoint.deviceId,
                            acknowledgedSeqMax = checkpoint.acknowledgedSeqMax,
                            acknowledgedAtIso8601 = checkpoint.acknowledgedAtIso8601
                        )
                    )
                }
            }

            if (rawSequence > 0L) {
                dao.upsertMetaValue(ROOM_RAW_SEQUENCE_KEY, rawSequence)
            }
        }

        defaults.removeObjectForKey(RAW_JOURNAL_KEY)
        defaults.removeObjectForKey(RAW_CHECKPOINTS_KEY)
        defaults.removeObjectForKey(RAW_SEQUENCE_KEY)
        defaults.setBool(true, ROOM_RAW_JOURNAL_MIGRATION_KEY)
        defaults.synchronize()
    }

    fun nextSequence(): Long {
        return runBlocking { dao.nextSequence() }
    }

    fun append(entry: RawJournalEntry) {
        runBlocking {
            dao.appendAndPrune(entry.toEntity(json), nativeCurrentTimeMillis())
        }
    }

    fun nextReplayBatch(endpointKey: String, nowMillis: Long, maxEvents: Int = 32): List<RawJournalEntry> {
        val entries = runBlocking {
            dao.pruneExpired(nowMillis - DEVICE_RAW_RETENTION_MS)
            dao.pruneOverflow(2048)
            dao.nextReplayBatch(endpointKey, maxEvents).map { it.toModel(json) }
        }
        if (entries.isEmpty()) return emptyList()
        val sessionId = entries.first().sessionId
        return entries
            .takeWhile { it.sessionId == sessionId }
            .take(maxEvents)
    }

    fun acknowledge(endpointKey: String, acknowledgedSeqMax: Long, acknowledgedAtIso8601: String): ReplayBatchResult {
        return runBlocking {
            val batchSize = dao.acknowledgedBatchSize(endpointKey, acknowledgedSeqMax)
            dao.deleteAcknowledged(endpointKey, acknowledgedSeqMax)
            val deviceId = dao.latestDeviceId(endpointKey)
                ?: dao.readCheckpoint(endpointKey)?.deviceId
                ?: "unknown-device"
            dao.writeCheckpoint(endpointKey, deviceId, acknowledgedSeqMax, acknowledgedAtIso8601)
            ReplayBatchResult(
                endpointKey = endpointKey,
                batchSize = batchSize,
                acknowledgedSeqMax = acknowledgedSeqMax,
                removedCount = batchSize
            )
        }
    }

    fun readCheckpoint(endpointKey: String): DeliveryWatermark? =
        runBlocking {
            dao.readCheckpoint(endpointKey)?.let {
                DeliveryWatermark(
                    endpointKey = it.endpointKey,
                    deviceId = it.deviceId,
                    acknowledgedSeqMax = it.acknowledgedSeqMax,
                    acknowledgedAtIso8601 = it.acknowledgedAtIso8601
                )
            }
        }

    fun pendingCount(endpointKey: String): Int =
        runBlocking { dao.pendingCount(endpointKey) }

    fun prune(nowMillis: Long) {
        runBlocking {
            dao.pruneExpired(nowMillis - DEVICE_RAW_RETENTION_MS)
            dao.pruneOverflow(ROOM_RAW_JOURNAL_MAX_ENTRIES.toInt())
        }
    }
}
private fun RawJournalEntry.toJson(): JsonObject =
    buildJsonObject {
        put("protocol", protocol)
        put("endpointKey", endpointKey)
        put("workspaceId", workspaceId)
        put("deviceId", deviceId)
        put("sessionId", sessionId)
        put("eventId", eventId)
        put("seq", seq)
        put("observedAt", observedAt)
        put("sentAt", sentAt)
        put("kind", kind)
        put("event", event)
        put("queuedAtMillis", queuedAtMillis)
    }

internal fun JsonObject.toRawJournalEntry(): RawJournalEntry =
    RawJournalEntry(
        protocol = getValue("protocol").jsonPrimitive.content,
        endpointKey = getValue("endpointKey").jsonPrimitive.content,
        workspaceId = getValue("workspaceId").jsonPrimitive.content,
        deviceId = getValue("deviceId").jsonPrimitive.content,
        sessionId = getValue("sessionId").jsonPrimitive.content,
        eventId = getValue("eventId").jsonPrimitive.content,
        seq = getValue("seq").jsonPrimitive.content.toLong(),
        observedAt = getValue("observedAt").jsonPrimitive.content,
        sentAt = getValue("sentAt").jsonPrimitive.content,
        kind = getValue("kind").jsonPrimitive.content,
        event = getValue("event").jsonObject,
        queuedAtMillis = getValue("queuedAtMillis").jsonPrimitive.content.toLong()
    )

private fun DeliveryWatermark.toJson(): JsonObject =
    buildJsonObject {
        put("endpointKey", endpointKey)
        put("deviceId", deviceId)
        put("acknowledgedSeqMax", acknowledgedSeqMax)
        put("acknowledgedAtIso8601", acknowledgedAtIso8601)
    }

internal fun JsonObject.toDeliveryWatermark(): DeliveryWatermark =
    DeliveryWatermark(
        endpointKey = getValue("endpointKey").jsonPrimitive.content,
        deviceId = getValue("deviceId").jsonPrimitive.content,
        acknowledgedSeqMax = getValue("acknowledgedSeqMax").jsonPrimitive.content.toLong(),
        acknowledgedAtIso8601 = getValue("acknowledgedAtIso8601").jsonPrimitive.content
    )

private fun RawJournalEntry.toEntity(json: Json): RawJournalEntity =
    RawJournalEntity(
        eventId = eventId,
        protocol = protocol,
        endpointKey = endpointKey,
        workspaceId = workspaceId,
        deviceId = deviceId,
        sessionId = sessionId,
        seq = seq,
        observedAt = observedAt,
        sentAt = sentAt,
        kind = kind,
        eventJson = json.encodeToString(JsonObject.serializer(), event),
        queuedAtMillis = queuedAtMillis
    )

private fun RawJournalEntity.toModel(json: Json): RawJournalEntry =
    RawJournalEntry(
        protocol = protocol,
        endpointKey = endpointKey,
        workspaceId = workspaceId,
        deviceId = deviceId,
        sessionId = sessionId,
        eventId = eventId,
        seq = seq,
        observedAt = observedAt,
        sentAt = sentAt,
        kind = kind,
        event = json.parseToJsonElement(eventJson).jsonObject,
        queuedAtMillis = queuedAtMillis
    )
