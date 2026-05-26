package io.github.kt.pulsebar.export

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.coroutines.runBlocking

private const val DEVICE_RAW_RETENTION_MS = 7L * 24L * 60L * 60L * 1000L
private const val ROOM_RAW_JOURNAL_MAX_ENTRIES = 10_000L

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

/**
 * Room-backed journal of outbound presence events and per-endpoint delivery
 * watermarks. Legacy `NSUserDefaults` migration paths were removed in the
 * Phase 1 cleanup; Room is now the only backing store.
 */
internal class PulseBarRawJournalStore {
    private val json = PulseBarRoomProvider.json
    private val database get() = PulseBarRoomProvider.database
    private val dao get() = database.rawJournalDao()

    fun nextSequence(): Long {
        return runBlocking { dao.nextSequence() }
    }

    fun append(entry: RawJournalEntry) {
        runBlocking {
//            dao.appendAndPrune(entry.toEntity(json), now())
        }
    }

    fun nextReplayBatch(endpointKey: String, nowMillis: Long, maxEvents: Int = 128): List<RawJournalEntry> {
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

//    fun acknowledge(endpointKey: String, acknowledgedSeqMax: Long, acknowledgedAtIso8601: String): ReplayBatchResult {
//        return runBlocking {
//            val batchSize = dao.acknowledgedBatchSize(endpointKey, acknowledgedSeqMax)
//            dao.deleteAcknowledged(endpointKey, acknowledgedSeqMax)
//            val deviceId = dao.latestDeviceId(endpointKey)
//                ?: dao.readCheckpoint(endpointKey)?.deviceId
//                ?: "unknown-device"
//            dao.writeCheckpoint(endpointKey, deviceId, acknowledgedSeqMax, acknowledgedAtIso8601)
//            ReplayBatchResult(
//                endpointKey = endpointKey,
//                batchSize = batchSize,
//                acknowledgedSeqMax = acknowledgedSeqMax,
//                removedCount = batchSize
//            )
//        }
//    }

//    fun readCheckpoint(endpointKey: String): DeliveryWatermark? =
//        runBlocking {
//            dao.readCheckpoint(endpointKey)?.let {
//                DeliveryWatermark(
//                    endpointKey = it.endpointKey,
//                    deviceId = it.deviceId,
//                    acknowledgedSeqMax = it.acknowledgedSeqMax,
//                    acknowledgedAtIso8601 = it.acknowledgedAtIso8601
//                )
//            }
//        }

    fun pendingCount(endpointKey: String): Int =
        runBlocking { dao.pendingCount(endpointKey) }

    fun prune(nowMillis: Long) {
        runBlocking {
            dao.pruneExpired(nowMillis - DEVICE_RAW_RETENTION_MS)
            dao.pruneOverflow(ROOM_RAW_JOURNAL_MAX_ENTRIES.toInt())
        }
    }
}

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
