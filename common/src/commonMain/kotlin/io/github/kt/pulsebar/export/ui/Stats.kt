package io.github.kt.pulsebar.export.ui

import kotlinx.coroutines.flow.Flow



data class UsageStats(
    val since: Long,
    val appStats: AppStats,
    val switchCount: Int,
    val mediaSeconds: Int,
)

data class AppStats(
    val totalSeconds: Int,
    val usages: Flow<List<AppUsageItem>>,
)