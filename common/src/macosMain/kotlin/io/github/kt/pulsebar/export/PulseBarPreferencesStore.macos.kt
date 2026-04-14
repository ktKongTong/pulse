package io.github.kt.pulsebar.export

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSJSONReadingMutableContainers
import platform.Foundation.NSJSONSerialization
import platform.Foundation.NSNumber
import platform.Foundation.NSUserDefaults

@OptIn(ExperimentalForeignApi::class)
internal class PulseBarPreferencesStore {
    private val defaults = NSUserDefaults.standardUserDefaults
    private val rootPath = NSHomeDirectory() + "/Library/Application Support/PulseBar"

    fun importLegacyFilesIfNeeded() {
        if (defaults.boolForKey("pulsebar.migration.legacy-json-import")) return
        importLegacyConfig()
        importLegacyUsage()
        defaults.setBool(true, "pulsebar.migration.legacy-json-import")
    }

    fun readConfig(): PulseBarConfig {
        val transportName = defaults.stringForKey("pulsebar.config.endpoint.transport") ?: PulseBarTransport.WEBSOCKET.name
        val transport = when (transportName) {
            "WEBHOOK" -> PulseBarTransport.WEBHOOK
            "HTTP_BATCH" -> PulseBarTransport.HTTP_BATCH
            else -> PulseBarTransport.WEBSOCKET
        }
        return PulseBarConfig(
            endpointEnabled = defaults.boolForKey("pulsebar.config.endpoint.enabled"),
            transport = transport,
            transportName = transportName,
            endpointUrl = defaults.stringForKey("pulsebar.config.endpoint.url") ?: "",
            apiKey = defaults.stringForKey("pulsebar.config.endpoint.apiKey") ?: "",
            batchWindowSeconds = intForKey("pulsebar.config.endpoint.batchWindowSeconds", 15),
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
        defaults.setBool(config.endpointEnabled, "pulsebar.config.endpoint.enabled")
        defaults.setObject(config.transportName, "pulsebar.config.endpoint.transport")
        defaults.setObject(config.endpointUrl, "pulsebar.config.endpoint.url")
        defaults.setObject(config.apiKey, "pulsebar.config.endpoint.apiKey")
        defaults.setInteger(config.batchWindowSeconds.toLong(), "pulsebar.config.endpoint.batchWindowSeconds")
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
    }

    fun incrementUsage(day: String, key: String, label: String, seconds: Int) {
        val prefix = "pulsebar.usage.$day.$key"
        val existing = defaults.integerForKey("$prefix.seconds").toInt()
        defaults.setObject(label, "$prefix.label")
        defaults.setInteger((existing + seconds).toLong(), "$prefix.seconds")
        defaults.synchronize()
    }

    fun incrementCounter(day: String, key: String, delta: Int = 1) {
        val storageKey = "pulsebar.stats.$day.$key"
        val existing = defaults.integerForKey(storageKey).toInt()
        defaults.setInteger((existing + delta).toLong(), storageKey)
        defaults.synchronize()
    }

    fun updateMaxCounter(day: String, key: String, candidate: Int) {
        val storageKey = "pulsebar.stats.$day.$key"
        val existing = defaults.integerForKey(storageKey).toInt()
        if (candidate > existing) {
            defaults.setInteger(candidate.toLong(), storageKey)
            defaults.synchronize()
        }
    }

    fun readCounter(day: String, key: String): Int =
        defaults.integerForKey("pulsebar.stats.$day.$key").toInt()

    fun debug(key: String, value: String) {
        defaults.setObject(value, key)
        defaults.synchronize()
    }

    fun debugReadUsage(day: String, key: String): Int =
        defaults.integerForKey("pulsebar.usage.$day.$key.seconds").toInt()

    fun topRowsForDay(day: String, limit: Int): List<PulseBarUsageRow> =
        rowsForDay(day, UsageSlice.APP, limit)

    fun rowsForDay(day: String, slice: UsageSlice, limit: Int): List<PulseBarUsageRow> {
        val prefix = "pulsebar.usage.$day."
        val dictionary = defaults.dictionaryRepresentation()
        val rawGrouped = linkedMapOf<String, Pair<String, Int>>()

        dictionary.forEach { (rawKey, rawValue) ->
            val key = rawKey as? String ?: return@forEach
            if (!key.startsWith(prefix)) return@forEach
            when {
                key.endsWith(".label") -> {
                    val statKey = key.removePrefix(prefix).removeSuffix(".label")
                    val label = rawValue as? String ?: "Unknown"
                    val previous = rawGrouped[statKey]
                    rawGrouped[statKey] = label to (previous?.second ?: 0)
                }
                key.endsWith(".seconds") -> {
                    val statKey = key.removePrefix(prefix).removeSuffix(".seconds")
                    val seconds = numberValue(rawValue)
                    val previous = rawGrouped[statKey]
                    rawGrouped[statKey] = (previous?.first ?: "Unknown") to seconds
                }
            }
        }

        val grouped = linkedMapOf<String, Pair<String, Int>>()
        rawGrouped.forEach { (statKey, value) ->
            val bundleId = statKey.substringBefore("::")
            if (bundleId in excludedStatsBundleIds) {
                return@forEach
            }
            val hasPage = statKey.contains("::")
            val hasMedia = statKey.contains("::media:")
            when (slice) {
                UsageSlice.APP -> {
                    val appLabel = value.first.substringBefore(" / ")
                    val previous = grouped[bundleId]
                    val mergedLabel = if (previous == null || previous.first == "Unknown") appLabel else previous.first
                    val mergedSeconds = (previous?.second ?: 0) + value.second
                    grouped[bundleId] = mergedLabel to mergedSeconds
                }
                UsageSlice.PAGE -> {
                    if (!hasPage || hasMedia) return@forEach
                    val previous = grouped[statKey]
                    val mergedSeconds = (previous?.second ?: 0) + value.second
                    grouped[statKey] = value.first to mergedSeconds
                }
                UsageSlice.MEDIA -> {
                    if (!hasMedia) return@forEach
                    val previous = grouped[statKey]
                    val mergedSeconds = (previous?.second ?: 0) + value.second
                    grouped[statKey] = value.first to mergedSeconds
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

    private fun importLegacyConfig() {
        val path = "$rootPath/config.json"
        val data = NSFileManager.defaultManager.contentsAtPath(path) ?: return
        val json = NSJSONSerialization.JSONObjectWithData(data, NSJSONReadingMutableContainers, null) as? Map<*, *> ?: return
        val endpoint = json["endpoint"] as? Map<*, *>
        defaults.setBool((endpoint?.get("enabled") as? Boolean) ?: false, "pulsebar.config.endpoint.enabled")
        defaults.setObject(endpoint?.get("transport") as? String ?: "WEBSOCKET", "pulsebar.config.endpoint.transport")
        defaults.setObject(endpoint?.get("url") as? String ?: "", "pulsebar.config.endpoint.url")
        defaults.setObject(endpoint?.get("apiKey") as? String ?: "", "pulsebar.config.endpoint.apiKey")
        defaults.setInteger(numberValue(endpoint?.get("batchWindowSeconds"), 15).toLong(), "pulsebar.config.endpoint.batchWindowSeconds")
        defaults.setInteger(numberValue(json["idleThresholdSeconds"], 300).toLong(), "pulsebar.config.idleThresholdSeconds")
        defaults.setInteger(numberValue(json["changeStabilityMillis"], 1200).toLong(), "pulsebar.config.changeStabilityMillis")
        defaults.setInteger(numberValue(json["heartbeatSeconds"], 60).toLong(), "pulsebar.config.heartbeatSeconds")
        defaults.setInteger(numberValue(json["appPollingMillis"], 500).toLong(), "pulsebar.config.appPollingMillis")
        defaults.setInteger(numberValue(json["pagePollingMillis"], 2000).toLong(), "pulsebar.config.pagePollingMillis")
        defaults.setInteger(numberValue(json["mediaPollingMillis"], 500).toLong(), "pulsebar.config.mediaPollingMillis")
        defaults.setBool((json["allowWebInteractions"] as? Boolean) ?: true, "pulsebar.config.interaction.enabled")
        defaults.setObject(json["interactionExecutionMode"] as? String ?: PulseBarInteractionExecutionMode.CONFIRM.name, "pulsebar.config.interaction.executionMode")
        defaults.setObject(json["interactionPlaybackMode"] as? String ?: PulseBarInteractionPlaybackMode.PLAY_NEXT.name, "pulsebar.config.interaction.playbackMode")
    }

    private fun importLegacyUsage() {
        val path = "$rootPath/usage-stats.json"
        val data = NSFileManager.defaultManager.contentsAtPath(path) ?: return
        val json = NSJSONSerialization.JSONObjectWithData(data, NSJSONReadingMutableContainers, null) as? List<*> ?: return
        json.forEach { item ->
            val map = item as? Map<*, *> ?: return@forEach
            val day = map["day"] as? String ?: return@forEach
            val key = map["key"] as? String ?: return@forEach
            val label = map["label"] as? String ?: "Unknown"
            val totalSeconds = numberValue(map["totalSeconds"], 0)
            val prefix = "pulsebar.usage.$day.$key"
            defaults.setObject(label, "$prefix.label")
            defaults.setInteger(totalSeconds.toLong(), "$prefix.seconds")
        }
        defaults.synchronize()
    }

    private fun intForKey(key: String, defaultValue: Int): Int {
        val value = defaults.integerForKey(key).toInt()
        return if (value == 0) defaultValue else value
    }

    private fun NSUserDefaults.containsKey(key: String): Boolean =
        dictionaryRepresentation().containsKey(key)

    private fun numberValue(value: Any?, defaultValue: Int = 0): Int =
        when (value) {
            is NSNumber -> value.intValue
            is Int -> value
            is Long -> value.toInt()
            is Double -> value.toInt()
            else -> defaultValue
        }
}
