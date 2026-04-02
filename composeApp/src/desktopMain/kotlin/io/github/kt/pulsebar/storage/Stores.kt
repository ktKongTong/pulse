package io.github.kt.pulsebar.storage

import io.github.kt.pulsebar.shared.ActivityLogEntry
import io.github.kt.pulsebar.shared.ActivitySnapshot
import io.github.kt.pulsebar.shared.MonitorConfig
import io.github.kt.pulsebar.shared.PrivacyMode
import io.github.kt.pulsebar.shared.UsageSummaryRow
import io.github.kt.pulsebar.shared.shouldAggregateUsage
import io.github.kt.pulsebar.presence.MediaPlaybackScope
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardOpenOption
import java.time.Duration
import java.time.Instant as JavaInstant
import java.time.ZoneId
import kotlin.io.path.exists
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

data class AppDataPaths(
    val root: Path = Paths.get(
        System.getProperty("user.home"),
        "Library",
        "Application Support",
        "PulseBar"
    )
) {
    val configFile: Path = root.resolve("config.json")
    val logFile: Path = root.resolve("activity-log.jsonl")
    val statsFile: Path = root.resolve("usage-stats.json")
    val snapshotFile: Path = root.resolve("current-snapshot.json")
}

private val json = Json {
    prettyPrint = true
    ignoreUnknownKeys = true
    encodeDefaults = true
}

private val compactJson = Json {
    prettyPrint = false
    ignoreUnknownKeys = true
    encodeDefaults = true
}

class ConfigStore(private val paths: AppDataPaths) {
    private val _config = MutableStateFlow(MonitorConfig())
    val config: StateFlow<MonitorConfig> = _config.asStateFlow()

    suspend fun load(): MonitorConfig = withContext(Dispatchers.IO) {
        ensureDirectory()
        val loaded = if (paths.configFile.exists()) {
            json.decodeFromString<MonitorConfig>(Files.readString(paths.configFile))
        } else {
            MonitorConfig()
        }
        _config.value = loaded
        save(loaded)
        loaded
    }

    suspend fun save(config: MonitorConfig) = withContext(Dispatchers.IO) {
        ensureDirectory()
        Files.writeString(
            paths.configFile,
            json.encodeToString(config),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE
        )
        _config.value = config
    }

    private fun ensureDirectory() {
        Files.createDirectories(paths.root)
    }
}

class LogStore(private val paths: AppDataPaths, private val maxEntries: Int = 500) {
    private val _entries = MutableStateFlow<List<ActivityLogEntry>>(emptyList())
    val entries: StateFlow<List<ActivityLogEntry>> = _entries.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        Files.createDirectories(paths.root)
        if (!paths.logFile.exists()) {
            _entries.value = emptyList()
            return@withContext
        }
        val content = Files.readString(paths.logFile)
        val parsed = parseLogEntries(content)
            .sortedByDescending { it.recordedAt }
            .take(maxEntries)
        _entries.value = parsed
    }

    suspend fun append(entry: ActivityLogEntry) = withContext(Dispatchers.IO) {
        Files.createDirectories(paths.root)
        Files.writeString(
            paths.logFile,
            compactJson.encodeToString(entry) + "\n",
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND,
            StandardOpenOption.WRITE
        )
        _entries.value = listOf(entry) + _entries.value.take(maxEntries - 1)
    }

    private fun parseLogEntries(content: String): List<ActivityLogEntry> {
        val lineEntries = content.lineSequence()
            .map { it.trim() }
            .filter { it.startsWith("{") && it.endsWith("}") }
            .mapNotNull {
                runCatching { compactJson.decodeFromString<ActivityLogEntry>(it) }.getOrNull()
            }
            .toList()
        if (lineEntries.isNotEmpty()) return lineEntries

        val chunks = mutableListOf<String>()
        val buffer = StringBuilder()
        var depth = 0
        var inString = false
        var escaping = false

        content.forEach { ch ->
            if (depth > 0 || !ch.isWhitespace()) {
                buffer.append(ch)
            }

            when {
                escaping -> escaping = false
                ch == '\\' && inString -> escaping = true
                ch == '"' -> inString = !inString
                !inString && ch == '{' -> depth += 1
                !inString && ch == '}' -> {
                    depth -= 1
                    if (depth == 0 && buffer.isNotBlank()) {
                        chunks += buffer.toString()
                        buffer.clear()
                    }
                }
            }
        }

        return chunks.mapNotNull { chunk ->
            runCatching { compactJson.decodeFromString<ActivityLogEntry>(chunk) }.getOrNull()
        }
    }
}

class UsageStore(private val paths: AppDataPaths) {
    private val _rows = MutableStateFlow<List<UsageSummaryRow>>(emptyList())
    val rows: StateFlow<List<UsageSummaryRow>> = _rows.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        Files.createDirectories(paths.root)
        val loaded = if (paths.statsFile.exists()) {
            json.decodeFromString(ListSerializer(UsageSummaryRow.serializer()), Files.readString(paths.statsFile))
        } else {
            emptyList()
        }
        _rows.value = loaded.sortedByDescending { it.lastSeenAt }
    }

    suspend fun recordSession(snapshot: ActivitySnapshot, startedAt: Instant, endedAt: Instant) =
        withContext(Dispatchers.IO) {
            if (!snapshot.shouldAggregateUsage()) return@withContext
            if (endedAt <= startedAt) return@withContext

            val zone = ZoneId.systemDefault()
            var cursor = JavaInstant.ofEpochMilli(startedAt.toEpochMilliseconds()).atZone(zone)
            val end = JavaInstant.ofEpochMilli(endedAt.toEpochMilliseconds()).atZone(zone)
            val buckets = _rows.value.associateBy { "${it.day}:${it.key}" }.toMutableMap()
            val key = activityKey(snapshot)
            val label = activityLabel(snapshot)

            while (cursor < end) {
                val boundary = minOf(
                    end,
                    cursor.toLocalDate().plusDays(1).atStartOfDay(zone)
                )
                val seconds = Duration.between(cursor, boundary).seconds
                if (seconds > 0) {
                    val day = LocalDate.parse(cursor.toLocalDate().toString())
                    val rowKey = "$day:$key"
                    val previous = buckets[rowKey]
                    buckets[rowKey] = UsageSummaryRow(
                        day = day,
                        key = key,
                        label = label,
                        privacyMode = snapshot.focus.privacyMode,
                        totalSeconds = (previous?.totalSeconds ?: 0L) + seconds,
                        lastSeenAt = endedAt
                    )
                }
                cursor = boundary
            }

            persist(buckets.values.toList())
        }

    private fun persist(rows: List<UsageSummaryRow>) {
        val sorted = rows.sortedWith(
            compareByDescending<UsageSummaryRow> { it.day }
                .thenByDescending { it.totalSeconds }
                .thenBy { it.label }
        )
        Files.writeString(
            paths.statsFile,
            json.encodeToString(ListSerializer(UsageSummaryRow.serializer()), sorted),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE
        )
        _rows.value = sorted
    }

    private fun activityKey(snapshot: ActivitySnapshot): String {
        val pageKey = snapshot.focus.page?.url?.takeIf { it.isNotBlank() }
            ?: snapshot.focus.page?.title?.takeIf { it.isNotBlank() }
        return buildString {
            append(snapshot.focus.bundleId)
            if (pageKey != null && snapshot.focus.privacyMode == PrivacyMode.TRACK) {
                append("::")
                append(pageKey)
            }
            snapshot.media?.takeIf {
                it.state.equals("playing", ignoreCase = true) && it.scope != MediaPlaybackScope.REMOTE
            }?.title?.let {
                append("::media:")
                append(it)
            }
        }
    }

    private fun activityLabel(snapshot: ActivitySnapshot): String {
        val pageTitle = snapshot.focus.page?.title?.takeIf { it.isNotBlank() }
        return when {
            pageTitle != null && snapshot.focus.privacyMode == PrivacyMode.TRACK ->
                "${snapshot.focus.appName} / $pageTitle"
            else -> snapshot.focus.appName
        }
    }
}

class SnapshotStore(private val paths: AppDataPaths) {
    suspend fun save(snapshot: ActivitySnapshot?) = withContext(Dispatchers.IO) {
        Files.createDirectories(paths.root)
        if (snapshot == null) {
            Files.deleteIfExists(paths.snapshotFile)
            return@withContext
        }
        Files.writeString(
            paths.snapshotFile,
            compactJson.encodeToString(ActivitySnapshot.serializer(), snapshot),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE
        )
    }
}
