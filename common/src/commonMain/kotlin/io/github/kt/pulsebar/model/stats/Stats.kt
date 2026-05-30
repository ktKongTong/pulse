package io.github.kt.pulsebar.model.stats

data class DailyStats(
    val day: String,
    val totalSeconds: Int,
)

data class App(
    val id: String,
    val name: String,
)

data class AppStatsItem(
    val app: App,
    val totalSeconds: Int,
)

data class AppStatsEntry(
    val app: App,
    val from: Long,
    val to: Long,
    val totalSeconds: Int,
)