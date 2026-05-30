package io.github.kt.pulsebar.store.database

import io.github.kt.pulsebar.store.database.model.*
import androidx.room3.Dao
import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.Query
import androidx.room3.Transaction
import androidx.room3.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
abstract class PulseBarUsageDao {
    @Upsert
    abstract suspend fun upsertApp(entity: AppEntity)

    @Upsert
    abstract suspend fun upsertApps(entities: List<AppEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertFocusSpan(entity: FocusSpanEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertFocusSpans(entities: List<FocusSpanEntity>)

    @Query("SELECT * FROM apps ORDER BY name COLLATE NOCASE")
    abstract fun apps(): Flow<List<AppEntity>>

    @Query(
        """
        SELECT *
        FROM focus_spans
        WHERE started_at_ms < :rangeEndMs
            AND ended_at_ms > :rangeStartMs
        ORDER BY started_at_ms ASC
        """
    )
    abstract fun focusSpansBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
    ): Flow<List<FocusSpanEntity>>

    fun appFocusBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        order: AppUsageOrder,
    ): Flow<List<AppFocusSummaryEntity>> =
        when (order) {
            AppUsageOrder.FOCUS_TIME -> appFocusByFocusTimeBetween(rangeStartMs, rangeEndMs)
            AppUsageOrder.APP_NAME -> appFocusByAppNameBetween(rangeStartMs, rangeEndMs)
        }

    @Query(
        """
        SELECT
            apps.app_id AS app_id,
            apps.platform AS platform,
            apps.platform_app_id AS platform_app_id,
            apps.name AS name,
            SUM(
                MIN(focus_spans.ended_at_ms, :rangeEndMs)
                - MAX(focus_spans.started_at_ms, :rangeStartMs)
            ) AS focus_ms,
            SUM(
                CASE
                    WHEN focus_spans.started_at_ms >= :rangeStartMs
                        AND focus_spans.started_at_ms < :rangeEndMs
                    THEN 1
                    ELSE 0
                END
            ) AS entered_count
        FROM focus_spans
        INNER JOIN apps ON apps.app_id = focus_spans.app_id
        WHERE focus_spans.started_at_ms < :rangeEndMs
            AND focus_spans.ended_at_ms > :rangeStartMs
        GROUP BY
            apps.app_id,
            apps.platform,
            apps.platform_app_id,
            apps.name
        HAVING focus_ms > 0
        ORDER BY focus_ms DESC, apps.name COLLATE NOCASE ASC
        """
    )
    abstract fun appFocusByFocusTimeBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
    ): Flow<List<AppFocusSummaryEntity>>

    @Query(
        """
        SELECT
            apps.app_id AS app_id,
            apps.platform AS platform,
            apps.platform_app_id AS platform_app_id,
            apps.name AS name,
            SUM(
                MIN(focus_spans.ended_at_ms, :rangeEndMs)
                - MAX(focus_spans.started_at_ms, :rangeStartMs)
            ) AS focus_ms,
            SUM(
                CASE
                    WHEN focus_spans.started_at_ms >= :rangeStartMs
                        AND focus_spans.started_at_ms < :rangeEndMs
                    THEN 1
                    ELSE 0
                END
            ) AS entered_count
        FROM focus_spans
        INNER JOIN apps ON apps.app_id = focus_spans.app_id
        WHERE focus_spans.started_at_ms < :rangeEndMs
            AND focus_spans.ended_at_ms > :rangeStartMs
        GROUP BY
            apps.app_id,
            apps.platform,
            apps.platform_app_id,
            apps.name
        HAVING focus_ms > 0
        ORDER BY apps.name COLLATE NOCASE ASC, focus_ms DESC
        """
    )
    abstract fun appFocusByAppNameBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
    ): Flow<List<AppFocusSummaryEntity>>

    suspend fun appFocusSnapshotBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
        order: AppUsageOrder,
    ): List<AppFocusSummaryEntity> =
        when (order) {
            AppUsageOrder.FOCUS_TIME -> appFocusSnapshotByFocusTimeBetween(rangeStartMs, rangeEndMs)
            AppUsageOrder.APP_NAME -> appFocusSnapshotByAppNameBetween(rangeStartMs, rangeEndMs)
        }

    @Query(
        """
        SELECT
            apps.app_id AS app_id,
            apps.platform AS platform,
            apps.platform_app_id AS platform_app_id,
            apps.name AS name,
            SUM(
                MIN(focus_spans.ended_at_ms, :rangeEndMs)
                - MAX(focus_spans.started_at_ms, :rangeStartMs)
            ) AS focus_ms,
            SUM(
                CASE
                    WHEN focus_spans.started_at_ms >= :rangeStartMs
                        AND focus_spans.started_at_ms < :rangeEndMs
                    THEN 1
                    ELSE 0
                END
            ) AS entered_count
        FROM focus_spans
        INNER JOIN apps ON apps.app_id = focus_spans.app_id
        WHERE focus_spans.started_at_ms < :rangeEndMs
            AND focus_spans.ended_at_ms > :rangeStartMs
        GROUP BY
            apps.app_id,
            apps.platform,
            apps.platform_app_id,
            apps.name
        HAVING focus_ms > 0
        ORDER BY focus_ms DESC, apps.name COLLATE NOCASE ASC
        """
    )
    abstract suspend fun appFocusSnapshotByFocusTimeBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
    ): List<AppFocusSummaryEntity>

    @Query(
        """
        SELECT
            apps.app_id AS app_id,
            apps.platform AS platform,
            apps.platform_app_id AS platform_app_id,
            apps.name AS name,
            SUM(
                MIN(focus_spans.ended_at_ms, :rangeEndMs)
                - MAX(focus_spans.started_at_ms, :rangeStartMs)
            ) AS focus_ms,
            SUM(
                CASE
                    WHEN focus_spans.started_at_ms >= :rangeStartMs
                        AND focus_spans.started_at_ms < :rangeEndMs
                    THEN 1
                    ELSE 0
                END
            ) AS entered_count
        FROM focus_spans
        INNER JOIN apps ON apps.app_id = focus_spans.app_id
        WHERE focus_spans.started_at_ms < :rangeEndMs
            AND focus_spans.ended_at_ms > :rangeStartMs
        GROUP BY
            apps.app_id,
            apps.platform,
            apps.platform_app_id,
            apps.name
        HAVING focus_ms > 0
        ORDER BY apps.name COLLATE NOCASE ASC, focus_ms DESC
        """
    )
    abstract suspend fun appFocusSnapshotByAppNameBetween(
        rangeStartMs: Long,
        rangeEndMs: Long,
    ): List<AppFocusSummaryEntity>

    @Transaction
    open suspend fun recordFocusSpans(
        apps: List<AppEntity>,
        spans: List<FocusSpanEntity>,
    ) {
        if (apps.isNotEmpty()) upsertApps(apps)
        if (spans.isNotEmpty()) insertFocusSpans(spans)
    }

    @Transaction
    open suspend fun recordFocusSpan(
        platform: String,
        platformAppId: String,
        name: String,
        startedAtMs: Long,
        endedAtMs: Long,
    ) {

        val appId = appIdFor(platform, platformAppId)
        upsertApp(
            AppEntity(
                appId = appId,
                platform = platform,
                platformAppId = platformAppId,
                name = name,
            )
        )
        insertFocusSpan(
            FocusSpanEntity(
                appId = appId,
                startedAtMs = startedAtMs,
                endedAtMs = endedAtMs,
            )
        )
    }
}

internal fun appIdFor(platform: String, platformAppId: String): String =
    "$platform:$platformAppId"
