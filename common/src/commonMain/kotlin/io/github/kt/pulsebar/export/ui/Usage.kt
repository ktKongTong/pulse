package io.github.kt.pulsebar.export.ui

import kotlin.Int
import kotlin.String

data class AppUsageItem(
    val key: String,
    val label: String,
    val bundleId: String,
    val totalSeconds: Int
)

data class App(
    val id: String,
    val label: String,
    val bundleId: String,
    val platform: String,
)

data class AppDailyStats(
    val day: String,
    val totalSeconds: Int,
)


// UsageSlice
enum class UsageSlice {
    APP,
    PAGE,
    MEDIA
}