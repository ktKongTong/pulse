package io.github.kt.pulsebar.export

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import platform.Foundation.NSDate
import platform.Foundation.NSUserDefaults

private const val DEVICE_RAW_RETENTION_MS = 7L * 24L * 60L * 60L * 1000L
private const val RAW_JOURNAL_KEY = "pulsebar.rawJournal.entries"
private const val RAW_CHECKPOINTS_KEY = "pulsebar.rawJournal.checkpoints"
private const val RAW_SEQUENCE_KEY = "pulsebar.rawJournal.sequence"

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
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    fun nextSequence(): Long {
        val next = defaults.integerForKey(RAW_SEQUENCE_KEY) + 1L
        defaults.setInteger(next, RAW_SEQUENCE_KEY)
        defaults.synchronize()
        return next
    }

    fun append(entry: RawJournalEntry) {
        val entries = readEntries()
            .filterNot { existing ->
                existing.endpointKey == entry.endpointKey &&
                    existing.deviceId == entry.deviceId &&
                    existing.eventId == entry.eventId
            }
            .plus(entry)
            .sortedBy { it.seq }
        writeEntries(pruneExpired(entries, rawJournalNowMillis()))
    }

    fun nextReplayBatch(endpointKey: String, nowMillis: Long, maxEvents: Int = 32): List<RawJournalEntry> {
        val entries = pruneAndRead(nowMillis)
            .filter { it.endpointKey == endpointKey }
            .sortedBy { it.seq }
        if (entries.isEmpty()) return emptyList()
        val sessionId = entries.first().sessionId
        return entries
            .takeWhile { it.sessionId == sessionId }
            .take(maxEvents)
    }

    fun acknowledge(endpointKey: String, acknowledgedSeqMax: Long, acknowledgedAtIso8601: String): ReplayBatchResult {
        val before = readEntries()
        val after = before.filterNot { it.endpointKey == endpointKey && it.seq <= acknowledgedSeqMax }
        val removedCount = before.size - after.size
        if (removedCount > 0) {
            writeEntries(after)
        }
        val watermark = DeliveryWatermark(
            endpointKey = endpointKey,
            deviceId = after.firstOrNull { it.endpointKey == endpointKey }?.deviceId
                ?: before.firstOrNull { it.endpointKey == endpointKey }?.deviceId
                ?: "unknown-device",
            acknowledgedSeqMax = acknowledgedSeqMax,
            acknowledgedAtIso8601 = acknowledgedAtIso8601
        )
        writeCheckpoints(readCheckpoints().toMutableMap().apply {
            this[endpointKey] = watermark
        })
        return ReplayBatchResult(
            endpointKey = endpointKey,
            batchSize = before.count { it.endpointKey == endpointKey && it.seq <= acknowledgedSeqMax },
            acknowledgedSeqMax = acknowledgedSeqMax,
            removedCount = removedCount
        )
    }

    fun readCheckpoint(endpointKey: String): DeliveryWatermark? =
        readCheckpoints()[endpointKey]

    fun prune(nowMillis: Long) {
        writeEntries(pruneExpired(readEntries(), nowMillis))
    }

    private fun pruneAndRead(nowMillis: Long): List<RawJournalEntry> {
        val pruned = pruneExpired(readEntries(), nowMillis)
        writeEntries(pruned)
        return pruned
    }

    private fun pruneExpired(entries: List<RawJournalEntry>, nowMillis: Long): List<RawJournalEntry> =
        entries.filter { nowMillis - it.queuedAtMillis <= DEVICE_RAW_RETENTION_MS }

    private fun readEntries(): List<RawJournalEntry> {
        val raw = defaults.stringForKey(RAW_JOURNAL_KEY) ?: return emptyList()
        return runCatching {
            json.parseToJsonElement(raw).jsonArray.map { it.jsonObject.toRawJournalEntry() }
        }.getOrDefault(emptyList())
    }

    private fun writeEntries(entries: List<RawJournalEntry>) {
        defaults.setObject(
            buildJsonArray {
                entries.forEach { add(it.toJson()) }
            }.toString(),
            RAW_JOURNAL_KEY
        )
        defaults.synchronize()
    }

    private fun readCheckpoints(): Map<String, DeliveryWatermark> {
        val raw = defaults.stringForKey(RAW_CHECKPOINTS_KEY) ?: return emptyMap()
        return runCatching {
            json.parseToJsonElement(raw).jsonArray
                .map { it.jsonObject.toDeliveryWatermark() }
                .associateBy { it.endpointKey }
        }.getOrDefault(emptyMap())
    }

    private fun writeCheckpoints(checkpoints: Map<String, DeliveryWatermark>) {
        defaults.setObject(
            buildJsonArray {
                checkpoints.values.sortedBy { it.endpointKey }.forEach { add(it.toJson()) }
            }.toString(),
            RAW_CHECKPOINTS_KEY
        )
        defaults.synchronize()
    }
}

private fun rawJournalNowMillis(): Long =
    (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

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

private fun JsonObject.toRawJournalEntry(): RawJournalEntry =
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

private fun JsonObject.toDeliveryWatermark(): DeliveryWatermark =
    DeliveryWatermark(
        endpointKey = getValue("endpointKey").jsonPrimitive.content,
        deviceId = getValue("deviceId").jsonPrimitive.content,
        acknowledgedSeqMax = getValue("acknowledgedSeqMax").jsonPrimitive.content.toLong(),
        acknowledgedAtIso8601 = getValue("acknowledgedAtIso8601").jsonPrimitive.content
    )
