package io.github.kt.pulsebar.export

import androidx.room3.ColumnInfo
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.PrimaryKey

@Entity(
    tableName = "usage_rows",
    primaryKeys = ["day_iso", "stat_key"]
)
internal data class UsageRowEntity(
    @ColumnInfo(name = "day_iso") val dayIso: String,
    @ColumnInfo(name = "stat_key") val statKey: String,
    @ColumnInfo(name = "bundle_id") val bundleId: String,
    @ColumnInfo(name = "label") val label: String,
    @ColumnInfo(name = "total_seconds") val totalSeconds: Int
)

@Entity(
    tableName = "usage_counters",
    primaryKeys = ["day_iso", "counter_key"]
)
internal data class UsageCounterEntity(
    @ColumnInfo(name = "day_iso") val dayIso: String,
    @ColumnInfo(name = "counter_key") val counterKey: String,
    @ColumnInfo(name = "value") val value: Int
)

@Entity(tableName = "app_meta")
internal data class AppMetaEntity(
    @PrimaryKey
    @ColumnInfo(name = "meta_key") val key: String,
    @ColumnInfo(name = "value") val value: Long
)

@Entity(
    tableName = "raw_journal",
    indices = [Index(value = ["endpoint_key", "seq"])]
)
internal data class RawJournalEntity(
    @PrimaryKey
    @ColumnInfo(name = "event_id") val eventId: String,
    @ColumnInfo(name = "protocol") val protocol: String,
    @ColumnInfo(name = "endpoint_key") val endpointKey: String,
    @ColumnInfo(name = "workspace_id") val workspaceId: String,
    @ColumnInfo(name = "device_id") val deviceId: String,
    @ColumnInfo(name = "session_id") val sessionId: String,
    @ColumnInfo(name = "seq") val seq: Long,
    @ColumnInfo(name = "observed_at") val observedAt: String,
    @ColumnInfo(name = "sent_at") val sentAt: String,
    @ColumnInfo(name = "kind") val kind: String,
    @ColumnInfo(name = "event_json") val eventJson: String,
    @ColumnInfo(name = "queued_at_millis") val queuedAtMillis: Long
)

@Entity(tableName = "delivery_watermarks")
internal data class DeliveryWatermarkEntity(
    @PrimaryKey
    @ColumnInfo(name = "endpoint_key") val endpointKey: String,
    @ColumnInfo(name = "device_id") val deviceId: String,
    @ColumnInfo(name = "acknowledged_seq_max") val acknowledgedSeqMax: Long,
    @ColumnInfo(name = "acknowledged_at_iso8601") val acknowledgedAtIso8601: String
)
