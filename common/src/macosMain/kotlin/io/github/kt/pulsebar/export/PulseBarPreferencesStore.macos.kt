package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import kotlinx.coroutines.runBlocking
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import platform.Foundation.NSUserDefaults

private const val ENDPOINTS_CONFIG_KEY = "pulsebar.config.endpoints.v1"
private const val DEFAULT_ENDPOINT_ID = "default-endpoint"
private const val DEFAULT_ENDPOINT_NAME = "Primary endpoint"

@OptIn(ExperimentalForeignApi::class)
internal class PulseBarPreferencesStore {
    private val defaults = NSUserDefaults.standardUserDefaults
    private val json = PulseBarRoomProvider.json
    private val database get() = PulseBarRoomProvider.database
    private val usageDao get() = database.usageDao()

    fun readConfig(): PulseBarConfig {
        return PulseBarConfig(
            endpoints = readEndpoints(),
            idleThresholdSeconds = intForKey("pulsebar.config.idleThresholdSeconds", 300),
            changeStabilityMillis = intForKey("pulsebar.config.changeStabilityMillis", 1200),
            heartbeatSeconds = intForKey("pulsebar.config.heartbeatSeconds", 60),
            appPollingMillis = intForKey("pulsebar.config.appPollingMillis", 500),
            pagePollingMillis = intForKey("pulsebar.config.pagePollingMillis", 2000),
            mediaPollingMillis = intForKey("pulsebar.config.mediaPollingMillis", 500),
            allowWebInteractions = defaults.boolForKey("pulsebar.config.interaction.enabled").let { if (!defaults.containsKey("pulsebar.config.interaction.enabled")) true else it },
            interactionExecutionMode = when (defaults.stringForKey("pulsebar.config.interaction.executionMode") ?: PulseBarInteractionExecutionMode.CONFIRM.name) {
                "AUTO_ENQUEUE" -> PulseBarInteractionExecutionMode.AUTO_ENQUEUE
                else -> PulseBarInteractionExecutionMode.CONFIRM
            },
            interactionExecutionModeName = defaults.stringForKey("pulsebar.config.interaction.executionMode") ?: PulseBarInteractionExecutionMode.CONFIRM.name,
            interactionPlaybackMode = when (defaults.stringForKey("pulsebar.config.interaction.playbackMode") ?: PulseBarInteractionPlaybackMode.PLAY_NEXT.name) {
                "PLAY_NOW" -> PulseBarInteractionPlaybackMode.PLAY_NOW
                else -> PulseBarInteractionPlaybackMode.PLAY_NEXT
            },
            interactionPlaybackModeName = defaults.stringForKey("pulsebar.config.interaction.playbackMode") ?: PulseBarInteractionPlaybackMode.PLAY_NEXT.name
        )
    }

    fun writeConfig(config: PulseBarConfig) {
        val endpoints = normalizeEndpoints(config.endpoints)
        defaults.setObject(
            buildJsonArray {
                endpoints.forEach { endpoint ->
                    add(endpoint.toJson())
                }
            }.toString(),
            ENDPOINTS_CONFIG_KEY
        )
        defaults.setInteger(config.idleThresholdSeconds.toLong(), "pulsebar.config.idleThresholdSeconds")
        defaults.setInteger(config.changeStabilityMillis.toLong(), "pulsebar.config.changeStabilityMillis")
        defaults.setInteger(config.heartbeatSeconds.toLong(), "pulsebar.config.heartbeatSeconds")
        defaults.setInteger(config.appPollingMillis.toLong(), "pulsebar.config.appPollingMillis")
        defaults.setInteger(config.pagePollingMillis.toLong(), "pulsebar.config.pagePollingMillis")
        defaults.setInteger(config.mediaPollingMillis.toLong(), "pulsebar.config.mediaPollingMillis")
        defaults.setBool(config.allowWebInteractions, "pulsebar.config.interaction.enabled")
        defaults.setObject(config.interactionExecutionModeName, "pulsebar.config.interaction.executionMode")
        defaults.setObject(config.interactionPlaybackModeName, "pulsebar.config.interaction.playbackMode")
        defaults.synchronize()
        logger(PulseLogCategory.ConfigStore).d {
            "config.persisted endpoints=${endpoints.size} exec=${config.interactionExecutionModeName} playback=${config.interactionPlaybackModeName}"
        }
    }

    fun incrementUsage(day: String, key: String, label: String, seconds: Int) {
        if (seconds <= 0) return
        runBlocking {
            usageDao.incrementUsage(
                dayIso = day,
                statKey = key,
                bundleId = key.substringBefore("::"),
                label = label,
                seconds = seconds
            )
        }
    }

    fun incrementCounter(day: String, key: String, delta: Int = 1) {
        if (delta == 0) return
        runBlocking {
            usageDao.incrementCounter(dayIso = day, counterKey = key, delta = delta)
        }
    }

    fun updateMaxCounter(day: String, key: String, candidate: Int) {
        runBlocking {
            usageDao.updateMaxCounter(dayIso = day, counterKey = key, candidate = candidate)
        }
    }

    fun readCounter(day: String, key: String): Int =
        runBlocking { usageDao.readCounter(dayIso = day, counterKey = key) ?: 0 }

    fun debug(key: String, value: String) {
        defaults.setObject(value, key)
        defaults.synchronize()
    }

    fun debugReadUsage(day: String, key: String): Int =
        runBlocking { usageDao.readUsageSeconds(dayIso = day, statKey = key) ?: 0 }

    fun topRowsForDay(day: String, limit: Int): List<PulseBarUsageRow> =
        rowsForDay(day, UsageSlice.APP, limit)

    fun rowsForDay(day: String, slice: UsageSlice, limit: Int): List<PulseBarUsageRow> {
        val rawRows = runBlocking { usageDao.rowsForDay(day) }

        val grouped = linkedMapOf<String, Pair<String, Int>>()
        rawRows.forEach { row ->
            val statKey = row.statKey
            val bundleId = row.bundleId
            if (bundleId in excludedStatsBundleIds) {
                return@forEach
            }
            val hasPage = statKey.contains("::")
            val hasMedia = statKey.contains("::media:")
            when (slice) {
                UsageSlice.APP -> {
                    val appLabel = row.label.substringBefore(" / ")
                    val previous = grouped[bundleId]
                    val mergedLabel = if (previous == null || previous.first == "Unknown") appLabel else previous.first
                    val mergedSeconds = (previous?.second ?: 0) + row.totalSeconds
                    grouped[bundleId] = mergedLabel to mergedSeconds
                }
                UsageSlice.PAGE -> {
                    if (!hasPage || hasMedia) return@forEach
                    val previous = grouped[statKey]
                    val mergedSeconds = (previous?.second ?: 0) + row.totalSeconds
                    grouped[statKey] = row.label to mergedSeconds
                }
                UsageSlice.MEDIA -> {
                    if (!hasMedia) return@forEach
                    val previous = grouped[statKey]
                    val mergedSeconds = (previous?.second ?: 0) + row.totalSeconds
                    grouped[statKey] = row.label to mergedSeconds
                }
            }
        }

        return grouped.entries
            .map { (key, value) ->
                PulseBarUsageRow(
                    key = key,
                    label = value.first,
                    bundleId = key.substringBefore("::"),
                    totalSeconds = value.second
                )
            }
            .sortedByDescending { it.totalSeconds }
            .let { rows -> if (limit > 0) rows.take(limit) else rows }
    }

    fun totalSecondsForDay(day: String, slice: UsageSlice): Int =
        rowsForDay(day, slice, 0).sumOf { it.totalSeconds }

    private fun readEndpoints(): List<PulseBarEndpointConfig> {
        val serialized = defaults.stringForKey(ENDPOINTS_CONFIG_KEY)
        if (serialized == null) {
            return normalizeEndpoints(listOf(defaultEndpointConfig()))
        }
        val parsed = runCatching {
            json.parseToJsonElement(serialized)
                .jsonArray
                .map { it.jsonObject.toPulseBarEndpointConfig() }
        }.getOrElse { error ->
            logger(PulseLogCategory.ConfigStore).w(error) {
                "config.endpoints.parse_failed key=$ENDPOINTS_CONFIG_KEY"
            }
            emptyList()
        }
        return normalizeEndpoints(parsed)
    }

    private fun defaultEndpointConfig(
        id: String = DEFAULT_ENDPOINT_ID,
        name: String = DEFAULT_ENDPOINT_NAME
    ): PulseBarEndpointConfig =
        PulseBarEndpointConfig(
            id = id,
            name = name,
            enabled = false,
            disconnected = false,
            transport = PulseBarTransport.WEBSOCKET,
            transportName = PulseBarTransport.WEBSOCKET.name,
            endpointUrl = "",
            workspaceId = "",
            siteId = "",
            apiKey = "",
            batchWindowSeconds = 15
        )

    private fun normalizeEndpoints(endpoints: List<PulseBarEndpointConfig>): List<PulseBarEndpointConfig> {
        val usedIds = mutableSetOf<String>()
        return endpoints.mapIndexed { index, endpoint ->
            val fallbackName = if (index == 0) DEFAULT_ENDPOINT_NAME else "Endpoint ${index + 1}"
            val baseId = endpoint.id
                .trim()
                .ifBlank {
                    endpoint.endpointUrl.trim().ifBlank { "endpoint-${index + 1}" }
                }
            var resolvedId = baseId
            var suffix = 2
            while (!usedIds.add(resolvedId)) {
                resolvedId = "$baseId-$suffix"
                suffix += 1
            }
            PulseBarEndpointConfig(
                id = resolvedId,
                name = endpoint.name.trim().ifBlank { fallbackName },
                enabled = endpoint.enabled,
                disconnected = endpoint.disconnected,
                transport = transportFromName(endpoint.transportName),
                transportName = endpoint.transportName.ifBlank { PulseBarTransport.WEBSOCKET.name },
                endpointUrl = endpoint.endpointUrl.trim(),
                workspaceId = endpoint.workspaceId.trim(),
                siteId = endpoint.siteId.trim(),
                apiKey = endpoint.apiKey,
                batchWindowSeconds = endpoint.batchWindowSeconds.coerceAtLeast(1)
            )
        }
    }

    private fun transportFromName(transportName: String): PulseBarTransport =
        when (transportName) {
            PulseBarTransport.WEBHOOK.name -> PulseBarTransport.WEBHOOK
            PulseBarTransport.HTTP_BATCH.name -> PulseBarTransport.HTTP_BATCH
            else -> PulseBarTransport.WEBSOCKET
        }

    private fun intForKey(key: String, defaultValue: Int): Int {
        val value = defaults.integerForKey(key).toInt()
        return if (value == 0) defaultValue else value
    }

    private fun NSUserDefaults.containsKey(key: String): Boolean =
        objectForKey(key) != null

    private fun PulseBarEndpointConfig.toJson() =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("enabled", enabled)
            put("disconnected", disconnected)
            put("transport", transportName)
            put("url", endpointUrl)
            put("workspaceId", workspaceId)
            put("siteId", siteId)
            put("apiKey", apiKey)
            put("batchWindowSeconds", batchWindowSeconds)
        }

    private fun kotlinx.serialization.json.JsonObject.toPulseBarEndpointConfig(): PulseBarEndpointConfig {
        val transportName = this["transport"]?.jsonPrimitive?.content ?: PulseBarTransport.WEBSOCKET.name
        return PulseBarEndpointConfig(
            id = this["id"]?.jsonPrimitive?.content.orEmpty(),
            name = this["name"]?.jsonPrimitive?.content.orEmpty(),
            enabled = this["enabled"]?.jsonPrimitive?.content == "true",
            disconnected = this["disconnected"]?.jsonPrimitive?.content == "true",
            transport = transportFromName(transportName),
            transportName = transportName,
            endpointUrl = this["url"]?.jsonPrimitive?.content.orEmpty(),
            workspaceId = this["workspaceId"]?.jsonPrimitive?.content.orEmpty(),
            siteId = this["siteId"]?.jsonPrimitive?.content.orEmpty(),
            apiKey = this["apiKey"]?.jsonPrimitive?.content.orEmpty(),
            batchWindowSeconds = this["batchWindowSeconds"]?.jsonPrimitive?.content?.toIntOrNull() ?: 15
        )
    }
}
