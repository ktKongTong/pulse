package io.github.kt.pulsebar.store.database.model

import androidx.room3.ColumnInfo
import androidx.room3.Entity
import androidx.room3.ForeignKey
import androidx.room3.Index
import androidx.room3.PrimaryKey
import io.github.kt.pulsebar.store.database.utils.OrderableColumn


@Entity(
    tableName = "apps",
    indices = [
        Index(value = ["platform", "platform_app_id"], unique = true)
    ]
)
data class AppEntity(
    @PrimaryKey
    @ColumnInfo(name = "app_id") val appId: String,
    @ColumnInfo(name = "platform") val platform: String,
    @ColumnInfo(name = "platform_app_id") val platformAppId: String,
    @ColumnInfo(name = "name") val name: String,
)



@Entity(
    tableName = "focus_spans",
    foreignKeys = [
        ForeignKey(
            entity = AppEntity::class,
            parentColumns = ["app_id"],
            childColumns = ["app_id"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
    indices = [
        Index(value = ["started_at_ms", "ended_at_ms"]),
        Index(value = ["app_id", "started_at_ms", "ended_at_ms"]),
    ]
)
data class FocusSpanEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "span_id") val spanId: Int = 0,
    @ColumnInfo(name = "app_id") val appId: String,
    @ColumnInfo(name = "started_at_ms") val startedAtMs: Long,
    @ColumnInfo(name = "ended_at_ms") val endedAtMs: Long,
)

enum class AppUsageOrder(override val col: String): OrderableColumn {
    FOCUS_TIME("focus_ms"),
    APP_NAME("name"),
}


data class AppFocusSummaryEntity(
    @ColumnInfo(name = "app_id") val appId: String,
    @ColumnInfo(name = "platform") val platform: String,
    @ColumnInfo(name = "platform_app_id") val platformAppId: String,
    @ColumnInfo(name = "name") val name: String,
    @ColumnInfo(name = "focus_ms") val focusMs: Long,
    @ColumnInfo(name = "entered_count") val enteredCount: Int,
)
