package io.github.kt.pulsebar.export

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

/**
 * Room-backed usage and counter store. Config persistence moved to
 * [io.github.kt.pulsebar.core.config.PulseBarConfigStore] in Phase 2; this
 * class no longer touches `NSUserDefaults` or JSON blobs.
 */
internal class PulseBarPreferencesStore {
    private val database get() = PulseBarRoomProvider.database
    private val usageDao get() = database.usageDao()

    fun incrementUsage(day: String, key: String, label: String, seconds: Int) {
        if (seconds <= 0) return
        runBlocking {
            usageDao.incrementUsage(
                dayIso = day,
                statKey = key,
                bundleId = key.substringBefore("::"),
                label = label,
                seconds = seconds,
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

    fun debugReadUsage(day: String, key: String): Int =
        runBlocking { usageDao.readUsageSeconds(dayIso = day, statKey = key) ?: 0 }

    fun topRowsForDay(day: String, limit: Int): List<PulseBarUsageRow> =
        rowsForDay(day, UsageSlice.APP, limit)

    fun rowsForDay(day: String, slice: UsageSlice, limit: Int): List<PulseBarUsageRow> {
        val rawRows = runBlocking { usageDao.rowsForDay(day) }
        return projectRows(rawRows, slice, limit)
    }

    fun totalSecondsForDay(day: String, slice: UsageSlice): Int =
        rowsForDay(day, slice, 0).sumOf { it.totalSeconds }

    /** Flow-based counterpart of [rowsForDay]. Emits whenever [UsageRowEntity] for [day] change. */
    fun rowsForDayFlow(day: String, slice: UsageSlice, limit: Int): Flow<List<PulseBarUsageRow>> =
        usageDao.rowsForDayFlow(day).map { rows -> projectRows(rows, slice, limit) }

    /** Flow variant of [topRowsForDay]. */
    fun topRowsForDayFlow(day: String, limit: Int): Flow<List<PulseBarUsageRow>> =
        rowsForDayFlow(day, UsageSlice.APP, limit)

    private fun projectRows(
        rawRows: List<UsageRowEntity>,
        slice: UsageSlice,
        limit: Int,
    ): List<PulseBarUsageRow> {
        val grouped = linkedMapOf<String, Pair<String, Int>>()
        rawRows.forEach { row ->
            val statKey = row.statKey
            val bundleId = row.bundleId
            if (bundleId in excludedStatsBundleIds) return@forEach
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
                    totalSeconds = value.second,
                )
            }
            .sortedByDescending { it.totalSeconds }
            .let { rows -> if (limit > 0) rows.take(limit) else rows }
    }
}
