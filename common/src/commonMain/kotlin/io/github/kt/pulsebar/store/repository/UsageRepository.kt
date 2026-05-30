package io.github.kt.pulsebar.store.repository

import io.github.kt.pulsebar.export.ui.AppUsageItem
import io.github.kt.pulsebar.store.database.PulseBarUsageDao
import io.github.kt.pulsebar.store.database.appIdFor
import io.github.kt.pulsebar.store.database.model.AppEntity
import io.github.kt.pulsebar.store.database.model.AppFocusSummaryEntity
import io.github.kt.pulsebar.store.database.model.AppUsageOrder
import io.github.kt.pulsebar.store.database.model.FocusSpanEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class UsageRepository(
    private val usageDao: PulseBarUsageDao,
) {
    suspend fun recordFocusSpan(record: AppFocusSpanRecord) {
        if (!record.isClosed) return
        if (record.endedAtMs <= record.startedAtMs) throw IllegalArgumentException("endedAtMs must be greater than startedAtMs")
        usageDao.recordFocusSpan(
            platform = record.platform,
            platformAppId = record.platformAppId,
            name = record.displayName,
            startedAtMs = record.startedAtMs,
            endedAtMs = record.endedAtMs,
        )
    }

    suspend fun recordFocusSpans(records: List<AppFocusSpanRecord>) {
        val closed = records.filter { it.isClosed }
        if (closed.isEmpty()) return

        usageDao.recordFocusSpans(
            apps = closed
                .distinctBy { it.appId }
                .map { it.toAppEntity() },
            spans = closed.map { it.toFocusSpanEntity() },
        )
    }

    fun appFocusBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        order: AppUsageOrder = AppUsageOrder.FOCUS_TIME,
    ): Flow<List<AppFocusSummary>> =
        usageDao
            .appFocusBetween(rangeStartMs, rangeEndMs, order)
            .map { rows -> rows.toAppFocusSummaries() }

    suspend fun appFocusSnapshotBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        order: AppUsageOrder = AppUsageOrder.FOCUS_TIME,
    ): List<AppFocusSummary> =
        usageDao
            .appFocusSnapshotBetween(rangeStartMs, rangeEndMs, order)
            .toAppFocusSummaries()

    fun appUsageItemsBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        limit: Int = 0,
        order: AppUsageOrder = AppUsageOrder.FOCUS_TIME,
    ): Flow<List<AppUsageItem>> =
        appFocusBetween(rangeStartMs, rangeEndMs, order)
            .map { rows -> rows.toUsageItems(limit) }

    suspend fun appUsageItemSnapshotBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        limit: Int = 20,
        order: AppUsageOrder = AppUsageOrder.FOCUS_TIME,
    ): List<AppUsageItem> =
        appFocusSnapshotBetween(rangeStartMs, rangeEndMs, order)
            .toUsageItems(limit)
}


data class AppFocusSpanRecord(
    val platform: String,
    val platformAppId: String,
    val displayName: String,
    val startedAtMs: Long,
    val endedAtMs: Long,
) {
    val appId: String get() = appIdFor(platform, platformAppId)
    val isClosed: Boolean get() = endedAtMs > startedAtMs

    fun toAppEntity(): AppEntity =
        AppEntity(
            appId = appId,
            platform = platform,
            platformAppId = platformAppId,
            name = displayName,
        )

    fun toFocusSpanEntity(): FocusSpanEntity =
        FocusSpanEntity(
            appId = appId,
            startedAtMs = startedAtMs,
            endedAtMs = endedAtMs,
        )
}

data class AppFocusSummary(
    val appId: String,
    val platform: String,
    val platformAppId: String,
    val displayName: String,
    val focusMs: Long,
    val enteredCount: Int,
) {
    val focusSeconds: Int get() = (focusMs / 1000L).toInt()
}

private fun List<AppFocusSummaryEntity>.toAppFocusSummaries(): List<AppFocusSummary> =
    map { row ->
        AppFocusSummary(
            appId = row.appId,
            platform = row.platform,
            platformAppId = row.platformAppId,
            displayName = row.name,
            focusMs = row.focusMs,
            enteredCount = row.enteredCount,
        )
    }

private fun List<AppFocusSummary>.toUsageItems(
    limit: Int,
): List<AppUsageItem> =
    let { rows -> if (limit > 0) rows.take(limit) else rows }
        .map { summary ->
            AppUsageItem(
                key = summary.appId,
                label = summary.displayName,
                bundleId = summary.platformAppId,
                totalSeconds = summary.focusSeconds,
            )
        }
