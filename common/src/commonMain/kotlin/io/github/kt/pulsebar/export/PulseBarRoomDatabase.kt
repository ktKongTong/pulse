package io.github.kt.pulsebar.export

import androidx.room3.ConstructedBy
import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Query
import androidx.room3.RoomDatabase
import androidx.room3.RoomDatabaseConstructor
import androidx.room3.Transaction
import androidx.room3.Upsert
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

private const val RAW_SEQUENCE_META_KEY = "raw_sequence"
private const val ROOM_RAW_JOURNAL_MAX_ENTRIES = 2048

@Dao
internal interface PulseBarUsageDao {
    @Upsert
    suspend fun upsertUsageRow(entity: UsageRowEntity)

    @Upsert
    suspend fun upsertUsageCounter(entity: UsageCounterEntity)

    @Query(
        """
        INSERT INTO usage_rows(day_iso, stat_key, bundle_id, label, total_seconds)
        VALUES (:dayIso, :statKey, :bundleId, :label, :seconds)
        ON CONFLICT(day_iso, stat_key) DO UPDATE SET
            bundle_id = excluded.bundle_id,
            label = excluded.label,
            total_seconds = usage_rows.total_seconds + excluded.total_seconds
        """
    )
    suspend fun incrementUsage(
        dayIso: String,
        statKey: String,
        bundleId: String,
        label: String,
        seconds: Int
    )

    @Query(
        """
        INSERT INTO usage_counters(day_iso, counter_key, value)
        VALUES (:dayIso, :counterKey, :delta)
        ON CONFLICT(day_iso, counter_key) DO UPDATE SET
            value = usage_counters.value + excluded.value
        """
    )
    suspend fun incrementCounter(dayIso: String, counterKey: String, delta: Int)

    @Query(
        """
        INSERT INTO usage_counters(day_iso, counter_key, value)
        VALUES (:dayIso, :counterKey, :candidate)
        ON CONFLICT(day_iso, counter_key) DO UPDATE SET
            value = MAX(usage_counters.value, excluded.value)
        """
    )
    suspend fun updateMaxCounter(dayIso: String, counterKey: String, candidate: Int)

    @Query("SELECT value FROM usage_counters WHERE day_iso = :dayIso AND counter_key = :counterKey")
    suspend fun readCounter(dayIso: String, counterKey: String): Int?

    @Query(
        """
        SELECT day_iso, stat_key, bundle_id, label, total_seconds
        FROM usage_rows
        WHERE day_iso = :dayIso
        """
    )
    suspend fun rowsForDay(dayIso: String): List<UsageRowEntity>

    @Query(
        """
        SELECT day_iso, stat_key, bundle_id, label, total_seconds
        FROM usage_rows
        WHERE day_iso = :dayIso
        """
    )
    fun rowsForDayFlow(dayIso: String): Flow<List<UsageRowEntity>>

    @Query("SELECT total_seconds FROM usage_rows WHERE day_iso = :dayIso AND stat_key = :statKey")
    suspend fun readUsageSeconds(dayIso: String, statKey: String): Int?
}

@Dao
internal abstract class PulseBarRawJournalDao {
    @Upsert
    abstract suspend fun upsertRawJournalEntity(entity: RawJournalEntity)

    @Upsert
    abstract suspend fun upsertCheckpointEntity(entity: DeliveryWatermarkEntity)

    @Upsert
    abstract suspend fun upsertMetaEntity(entity: AppMetaEntity)

    @Query(
        """
        INSERT OR REPLACE INTO raw_journal(
            event_id,
            protocol,
            endpoint_key,
            workspace_id,
            device_id,
            session_id,
            seq,
            observed_at,
            sent_at,
            kind,
            event_json,
            queued_at_millis
        ) VALUES (
            :eventId,
            :protocol,
            :endpointKey,
            :workspaceId,
            :deviceId,
            :sessionId,
            :seq,
            :observedAt,
            :sentAt,
            :kind,
            :eventJson,
            :queuedAtMillis
        )
        """
    )
    abstract suspend fun insertRawJournal(
        eventId: String,
        protocol: String,
        endpointKey: String,
        workspaceId: String,
        deviceId: String,
        sessionId: String,
        seq: Long,
        observedAt: String,
        sentAt: String,
        kind: String,
        eventJson: String,
        queuedAtMillis: Long
    )

    @Query(
        """
        SELECT * FROM raw_journal
        WHERE endpoint_key = :endpointKey
        ORDER BY seq ASC
        LIMIT :maxEvents
        """
    )
    abstract suspend fun nextReplayBatch(endpointKey: String, maxEvents: Int): List<RawJournalEntity>

    @Query("SELECT COUNT(*) FROM raw_journal WHERE endpoint_key = :endpointKey")
    abstract suspend fun pendingCount(endpointKey: String): Int

    @Query("DELETE FROM raw_journal WHERE endpoint_key = :endpointKey AND seq <= :acknowledgedSeqMax")
    abstract suspend fun deleteAcknowledged(endpointKey: String, acknowledgedSeqMax: Long)

    @Query("DELETE FROM raw_journal WHERE queued_at_millis < :cutoffMillis")
    abstract suspend fun pruneExpired(cutoffMillis: Long)

    @Query(
        """
        DELETE FROM raw_journal
        WHERE event_id IN (
            SELECT event_id
            FROM raw_journal
            ORDER BY seq DESC
            LIMIT -1 OFFSET :maxEntries
        )
        """
    )
    abstract suspend fun pruneOverflow(maxEntries: Int)

    @Query(
        """
        INSERT INTO delivery_watermarks(endpoint_key, device_id, acknowledged_seq_max, acknowledged_at_iso8601)
        VALUES (:endpointKey, :deviceId, :acknowledgedSeqMax, :acknowledgedAtIso8601)
        ON CONFLICT(endpoint_key) DO UPDATE SET
            device_id = excluded.device_id,
            acknowledged_seq_max = excluded.acknowledged_seq_max,
            acknowledged_at_iso8601 = excluded.acknowledged_at_iso8601
        """
    )
    abstract suspend fun writeCheckpoint(
        endpointKey: String,
        deviceId: String,
        acknowledgedSeqMax: Long,
        acknowledgedAtIso8601: String
    )

    @Query("SELECT * FROM delivery_watermarks WHERE endpoint_key = :endpointKey")
    abstract suspend fun readCheckpoint(endpointKey: String): DeliveryWatermarkEntity?

    @Query("SELECT device_id FROM raw_journal WHERE endpoint_key = :endpointKey ORDER BY seq DESC LIMIT 1")
    abstract suspend fun latestDeviceId(endpointKey: String): String?

    @Query("SELECT value FROM app_meta WHERE meta_key = :key")
    abstract suspend fun readMetaValueInternal(key: String): Long?

    @Query(
        """
        INSERT INTO app_meta(meta_key, value)
        VALUES (:key, :value)
        ON CONFLICT(meta_key) DO UPDATE SET value = excluded.value
        """
    )
    abstract suspend fun writeMetaValue(key: String, value: Long)

    @Query("SELECT COUNT(*) FROM raw_journal WHERE endpoint_key = :endpointKey AND seq <= :acknowledgedSeqMax")
    abstract suspend fun acknowledgedBatchSize(endpointKey: String, acknowledgedSeqMax: Long): Int

    @Transaction
    open suspend fun nextSequence(): Long {
        val next = (readMetaValueInternal(RAW_SEQUENCE_META_KEY) ?: 0L) + 1L
        writeMetaValue(RAW_SEQUENCE_META_KEY, next)
        return next
    }

    @Transaction
    open suspend fun upsertMetaValue(key: String, value: Long) {
        writeMetaValue(key, value)
    }

    @Transaction
    open suspend fun readMetaValue(key: String): Long? =
        readMetaValueInternal(key)

    @Transaction
    open suspend fun upsertCheckpoint(checkpoint: DeliveryWatermarkEntity) {
        writeCheckpoint(
            endpointKey = checkpoint.endpointKey,
            deviceId = checkpoint.deviceId,
            acknowledgedSeqMax = checkpoint.acknowledgedSeqMax,
            acknowledgedAtIso8601 = checkpoint.acknowledgedAtIso8601
        )
    }

    @Transaction
    open suspend fun appendAndPrune(entry: RawJournalEntity, nowMillis: Long) {
        upsertRawJournalEntity(entry)
        pruneExpired(nowMillis - 7L * 24L * 60L * 60L * 1000L)
        pruneOverflow(ROOM_RAW_JOURNAL_MAX_ENTRIES)
    }
}

@Database(
    version = 1,
    exportSchema = true,
    entities = [
        UsageRowEntity::class,
        UsageCounterEntity::class,
        AppMetaEntity::class,
        RawJournalEntity::class,
        DeliveryWatermarkEntity::class
    ]
)
@ConstructedBy(PulseBarRoomDatabaseConstructor::class)
internal abstract class PulseBarRoomDatabase : RoomDatabase() {
    abstract fun usageDao(): PulseBarUsageDao
    abstract fun rawJournalDao(): PulseBarRawJournalDao
}

@Suppress("KotlinNoActualForExpect")
internal expect object PulseBarRoomDatabaseConstructor : RoomDatabaseConstructor<PulseBarRoomDatabase> {
    override fun initialize(): PulseBarRoomDatabase
}

internal expect fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase>

internal object PulseBarRoomProvider {
    val json: Json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    val database: PulseBarRoomDatabase by lazy {
        pulseBarRoomDatabaseBuilder()
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.Default)
            .build()
    }
}
