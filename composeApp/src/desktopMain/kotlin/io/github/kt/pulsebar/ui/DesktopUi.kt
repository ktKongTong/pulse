package io.github.kt.pulsebar.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Subject
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ApplicationScope
import androidx.compose.ui.window.Tray
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowState
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import io.github.kt.pulsebar.app.AppController
import io.github.kt.pulsebar.app.AppUiState
import io.github.kt.pulsebar.shared.ActivityLogEntry
import io.github.kt.pulsebar.shared.AppRule
import io.github.kt.pulsebar.shared.EndpointTransport
import io.github.kt.pulsebar.shared.MonitorConfig
import io.github.kt.pulsebar.shared.PrivacyMode
import io.github.kt.pulsebar.shared.RuleMatcher
import io.github.kt.pulsebar.shared.UsageSummaryRow
import io.github.kt.pulsebar.shared.formatDuration
import io.github.kt.pulsebar.shared.formatPlaybackProgress
import java.awt.BasicStroke
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.net.URL
import javax.imageio.ImageIO
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

fun launchPulseBar(controller: AppController) = application {
    val scope = rememberCoroutineScope()
    var showSettings by rememberSaveable { mutableStateOf(false) }
    val settingsWindowState = rememberWindowState(width = 1100.dp, height = 760.dp)

    PulseBarTray(
        controller = controller,
        onOpenSettings = { showSettings = true },
        onQuit = {
            scope.launch {
                controller.shutdown()
                exitApplication()
            }
        }
    )

    SettingsWindowHost(
        controller = controller,
        visible = showSettings,
        windowState = settingsWindowState,
        onHide = { showSettings = false }
    )
}

@Composable
private fun ApplicationScope.PulseBarTray(
    controller: AppController,
    onOpenSettings: () -> Unit,
    onQuit: () -> Unit
) {
    val uiState by controller.uiState.collectAsState()
    val nowEpochMillis by produceState(initialValue = System.currentTimeMillis()) {
        while (true) {
            value = System.currentTimeMillis()
            delay(1000)
        }
    }
    val todayRows = remember(uiState.usageRows, nowEpochMillis) {
        val today = currentLocalDate()
        uiState.usageRows
            .filter { it.day == today }
            .sortedByDescending { it.totalSeconds }
            .take(3)
    }
    val liveDurationText = uiState.stableSince?.let {
        "Active ${formatDuration(((nowEpochMillis - it.toEpochMilliseconds()).coerceAtLeast(0) / 1000))}"
    }
    val media = uiState.liveSnapshot?.media
    val trayProgressText = media?.let {
        val durationLimit = it.durationSeconds?.toDouble()
        val sampleObservedAt = uiState.liveSnapshot?.observedAt?.toEpochMilliseconds() ?: nowEpochMillis
        val derived = if (it.state.equals("playing", ignoreCase = true)) {
            (it.progressSeconds ?: 0.0) + (nowEpochMillis - sampleObservedAt).coerceAtLeast(0) / 1000.0
        } else {
            it.progressSeconds ?: 0.0
        }
        formatPlaybackProgress(durationLimit?.let { limit -> derived.coerceAtMost(limit) } ?: derived, it.durationSeconds)
    }

    Tray(
        icon = rememberTrayPainter(active = !uiState.isPaused),
        tooltip = uiState.currentLabel,
        onAction = {},
        menu = {
            Item(text = "PulseBar", enabled = false, onClick = {})
            Item(text = uiState.currentLabel.ellipsize(48), enabled = false, onClick = {})
            liveDurationText?.let { Item(text = it, enabled = false, onClick = {}) }

            media?.let {
                Separator()
                Item(
                    text = "${it.source}: ${(it.title ?: "Unknown").ellipsize(38)}",
                    enabled = false,
                    onClick = {}
                )
                it.artist?.takeIf { artist -> artist.isNotBlank() }?.let { artist ->
                    Item(text = artist.ellipsize(48), enabled = false, onClick = {})
                }
                trayProgressText?.let { progress ->
                    Item(text = progress, enabled = false, onClick = {})
                }
            }

            if (todayRows.isNotEmpty()) {
                Separator()
                Item(text = "Today", enabled = false, onClick = {})
                todayRows.forEach { row ->
                    Item(
                        text = "${formatDuration(row.totalSeconds)}  ${row.label}".ellipsize(48),
                        enabled = false,
                        onClick = {}
                    )
                }
            }

            Separator()
            Item(
                text = if (uiState.isPaused) "Resume monitoring" else "Pause monitoring",
                onClick = controller::togglePaused
            )
            Item(
                text = "Open settings",
                onClick = onOpenSettings
            )
            Separator()
            Item(
                text = uiState.currentLabel.take(80),
                enabled = false,
                onClick = {}
            )
            Item(
                text = "Quit",
                onClick = onQuit
            )
        }
    )
}

@Composable
private fun ApplicationScope.SettingsWindowHost(
    controller: AppController,
    visible: Boolean,
    windowState: WindowState,
    onHide: () -> Unit
) {
    if (!visible) return

    Window(
        onCloseRequest = onHide,
        title = "PulseBar Settings",
        state = windowState
    ) {
        val uiState by controller.uiState.collectAsState()

        MaterialTheme {
            Surface(modifier = Modifier.fillMaxSize()) {
                SettingsScreen(
                    uiState = uiState,
                    controller = controller,
                    onHide = onHide
                )
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    uiState: AppUiState,
    controller: AppController,
    onHide: () -> Unit
) {
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf("Overview", "General", "Privacy", "Endpoint", "Stats", "Logs")

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Header(uiState = uiState, onHide = onHide)
        PrimaryTabRow(selectedTabIndex = selectedTab) {
            tabs.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    text = { Text(title) }
                )
            }
        }
        when (selectedTab) {
            0 -> OverviewTab(uiState, controller)
            1 -> GeneralTab(uiState.config, controller)
            2 -> PrivacyTab(uiState, controller)
            3 -> EndpointTab(uiState.config, controller)
            4 -> StatsTab(uiState.usageRows)
            else -> LogsTab(uiState.logs)
        }
    }
}

@Composable
private fun Header(uiState: AppUiState, onHide: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        Column(
            modifier = Modifier.weight(1f).padding(end = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text("PulseBar", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text(
                uiState.currentLabel,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                uiState.stableSince?.let { "Stable since ${it.toLocalDateTime(TimeZone.currentSystemDefault())}" } ?: " ",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                uiState.suppressedReason ?: " ",
                style = MaterialTheme.typography.bodySmall,
                color = if (uiState.suppressedReason != null) {
                    MaterialTheme.colorScheme.error
                } else {
                    Color.Transparent
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Row(
            modifier = Modifier.width(320.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.Top
        ) {
            Text(
                uiState.lastPushStatus,
                modifier = Modifier.weight(1f).padding(top = 10.dp),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.width(12.dp))
            OutlinedButton(onClick = onHide) {
                Text("Hide window")
            }
        }
    }
}

@Composable
private fun OverviewTab(uiState: AppUiState, controller: AppController) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        SummaryCard(
            icon = { Icon(Icons.Outlined.Analytics, null) },
            title = "Live status",
            body = buildString {
                append(uiState.liveSnapshot?.focus?.appName ?: "No snapshot yet")
                uiState.liveSnapshot?.focus?.page?.title?.takeIf { it.isNotBlank() }?.let {
                    append("\nPage: $it")
                }
                uiState.liveSnapshot?.media?.let { media ->
                    append("\nMedia: ${media.source} / ${media.title ?: "Unknown"}")
                    media.artist?.takeIf { it.isNotBlank() }?.let {
                        append(" - ")
                        append(it)
                    }
                    media.trackId?.takeIf { it.isNotBlank() }?.let {
                        append("\nTrack ID: ")
                        append(it)
                    }
                }
            }
        ) {
            uiState.liveSnapshot?.let { snapshot ->
                snapshot.media?.let { media ->
                    MediaDetails(snapshot, media)
                }
            }
        }

        SummaryCard(
            icon = { Icon(Icons.Outlined.Tune, null) },
            title = "Quick privacy actions",
            body = uiState.liveSnapshot?.focus?.bundleId ?: "No frontmost app detected"
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { controller.addRuleForCurrentApp(PrivacyMode.ANONYMIZE) }) {
                    Text("Anonymize current app")
                }
                OutlinedButton(onClick = { controller.addRuleForCurrentApp(PrivacyMode.EXCLUDE) }) {
                    Text("Exclude current app")
                }
                Button(onClick = controller::togglePaused) {
                    Text(if (uiState.isPaused) "Resume monitor" else "Pause monitor")
                }
            }
        }

        SummaryCard(
            icon = { Icon(Icons.Outlined.Subject, null) },
            title = "Diagnostics",
            body = if (uiState.diagnostics.isEmpty()) {
                "No probe warnings."
            } else {
                uiState.diagnostics.joinToString("\n")
            }
        )

        SummaryCard(
            icon = { Icon(Icons.Outlined.Link, null) },
            title = "Protocol proposal",
            body = """
                Device ingest: POST presence.v2 requests to /v2/presence/ingest.
                Realtime fanout belongs on the server side via SSE/WS.
                Orthogonal state axes:
                - availability.state: active | idle | locked | sleeping | offline
                - focus.state: foreground | background | none
                - presenceKind: interactive | passive | media
                Media is provider-agnostic and reported as mediaSessions[].
            """.trimIndent()
        )
    }
}

@Composable
private fun MediaDetails(
    snapshot: io.github.kt.pulsebar.shared.ActivitySnapshot,
    media: io.github.kt.pulsebar.shared.MediaContext
) {
    val displayedProgressSeconds = rememberSyncedPlaybackProgress(snapshot, media)

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.Top
    ) {
        ArtworkImage(
            artworkUrl = media.artworkUrl,
            fallbackLabel = media.title?.take(1) ?: media.source.take(1)
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                media.title ?: "Unknown track",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                listOfNotNull(media.artist, media.album).joinToString(" · ").ifBlank { media.source },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            formatPlaybackProgress(displayedProgressSeconds, media.durationSeconds)?.let {
                Text("Progress: $it", style = MaterialTheme.typography.bodySmall)
            }
            media.trackId?.takeIf { it.isNotBlank() }?.let {
                SelectionContainer {
                    Text("Track ID: $it", style = MaterialTheme.typography.bodySmall)
                }
            }
            media.linkUrl?.takeIf { it.isNotBlank() }?.let {
                SelectionContainer {
                    Text("Link: $it", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun rememberSyncedPlaybackProgress(
    snapshot: io.github.kt.pulsebar.shared.ActivitySnapshot,
    media: io.github.kt.pulsebar.shared.MediaContext
): Double? {
    val durationLimit = media.durationSeconds?.toDouble()
    val baseProgress = media.progressSeconds ?: return null

    val progress by produceState(
        initialValue = baseProgress,
        snapshot.observedAt.toEpochMilliseconds(),
        media.trackId ?: media.title ?: media.source,
        media.state,
        media.progressSeconds,
        media.durationSeconds
    ) {
        val sampleProgress = media.progressSeconds ?: 0.0
        val sampleObservedAtMillis = snapshot.observedAt.toEpochMilliseconds()
        val isPlaying = media.state.equals("playing", ignoreCase = true)

        while (true) {
            val derived = if (isPlaying) {
                val elapsedMillis = (System.currentTimeMillis() - sampleObservedAtMillis).coerceAtLeast(0L)
                sampleProgress + elapsedMillis / 1000.0
            } else {
                sampleProgress
            }

            value = durationLimit?.let { derived.coerceAtMost(it) } ?: derived
            delay(if (isPlaying) 250 else 1000)
        }
    }

    return progress
}

@Composable
private fun ArtworkImage(artworkUrl: String?, fallbackLabel: String) {
    val image by produceState<ImageBitmap?>(initialValue = null, artworkUrl) {
        val url = artworkUrl?.takeIf { it.isNotBlank() }
        value = if (url != null) loadRemoteArtwork(url) else null
    }

    Box(
        modifier = Modifier
            .size(96.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(20.dp))
            .background(
                MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                RoundedCornerShape(20.dp)
            ),
        contentAlignment = Alignment.Center
    ) {
        if (image != null) {
            Image(
                bitmap = image!!,
                contentDescription = "Artwork",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
        } else {
            Text(
                fallbackLabel,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

private suspend fun loadRemoteArtwork(url: String): ImageBitmap? = withContext(Dispatchers.IO) {
    runCatching {
        URL(url).openStream().use { stream ->
            ImageIO.read(stream)?.toComposeImageBitmap()
        }
    }.getOrNull()
}

private fun currentLocalDate(): LocalDate =
    Instant.fromEpochMilliseconds(System.currentTimeMillis())
        .toLocalDateTime(TimeZone.currentSystemDefault())
        .date

private fun String.ellipsize(maxChars: Int): String =
    if (length <= maxChars) this else take((maxChars - 1).coerceAtLeast(1)) + "…"

@Composable
private fun GeneralTab(config: MonitorConfig, controller: AppController) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        SummaryCard(
            icon = { Icon(Icons.Outlined.Settings, null) },
            title = "Sampling and stability",
            body = "Lower values react faster, higher values reduce local probe overhead and filter unstable focus changes."
        ) {
            NumericField("Idle threshold (seconds)", config.idleThresholdSeconds) {
                controller.updateConfig { current -> current.copy(idleThresholdSeconds = it.coerceAtLeast(30)) }
            }
            NumericField("Change stability (ms)", config.changeStabilityMillis) {
                controller.updateConfig { current -> current.copy(changeStabilityMillis = it.coerceAtLeast(250)) }
            }
            NumericField("Heartbeat (seconds)", config.heartbeatSeconds) {
                controller.updateConfig { current -> current.copy(heartbeatSeconds = it.coerceAtLeast(5)) }
            }
            NumericField("Front app polling (ms)", config.appPollingMillis) {
                controller.updateConfig { current -> current.copy(appPollingMillis = it.coerceIn(250, 5_000)) }
            }
            NumericField("Browser polling (ms)", config.pagePollingMillis) {
                controller.updateConfig { current -> current.copy(pagePollingMillis = it.coerceAtLeast(1000)) }
            }
            NumericField("Media polling (ms)", config.mediaPollingMillis) {
                controller.updateConfig { current -> current.copy(mediaPollingMillis = it.coerceIn(250, 5_000)) }
            }
        }
    }
}

@Composable
private fun PrivacyTab(uiState: AppUiState, controller: AppController) {
    var newPattern by rememberSaveable { mutableStateOf("") }
    var matcher by rememberSaveable { mutableStateOf(RuleMatcher.BUNDLE_ID_CONTAINS) }
    var mode by rememberSaveable { mutableStateOf(PrivacyMode.ANONYMIZE) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        SummaryCard(
            icon = { Icon(Icons.Outlined.Lock, null) },
            title = "Privacy rules",
            body = "Anonymize keeps duration statistics but redacts app/page/media details. Exclude removes the app from stats and push events."
        ) {
            OutlinedTextField(
                value = newPattern,
                onValueChange = { newPattern = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Pattern") },
                supportingText = { Text("Usually use bundle id, for example com.google.Chrome") }
            )
            Spacer(Modifier.height(8.dp))
            EnumSelector("Matcher", matcher, RuleMatcher.entries) { matcher = it }
            Spacer(Modifier.height(8.dp))
            EnumSelector("Mode", mode, PrivacyMode.entries) { mode = it }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    if (newPattern.isNotBlank()) {
                        controller.updateConfig { config ->
                            config.copy(appRules = config.appRules + AppRule(newPattern.trim(), matcher, mode))
                        }
                        newPattern = ""
                    }
                }
            ) {
                Text("Add rule")
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Existing rules", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (uiState.config.appRules.isEmpty()) {
                    Text("No rules configured.")
                } else {
                    uiState.config.appRules.forEachIndexed { index, rule ->
                        RuleRow(rule = rule, onRemove = { controller.removeRule(index) })
                        if (index < uiState.config.appRules.lastIndex) {
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EndpointTab(config: MonitorConfig, controller: AppController) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        SummaryCard(
            icon = { Icon(Icons.Outlined.Link, null) },
            title = "Push endpoint",
            body = "Device side now emits presence.v2 ingest payloads over HTTP append. The legacy transport selector remains here as a compatibility toggle for single-event vs batched POST behavior."
        ) {
            LabeledSwitch(
                label = "Enable endpoint",
                checked = config.endpoint.enabled,
                onCheckedChange = { enabled ->
                    controller.updateConfig { current ->
                        current.copy(endpoint = current.endpoint.copy(enabled = enabled))
                    }
                }
            )
            Spacer(Modifier.height(8.dp))
            EnumSelector("Transport", config.endpoint.transport, EndpointTransport.entries) {
                controller.updateConfig { current ->
                    current.copy(endpoint = current.endpoint.copy(transport = it))
                }
            }
            Spacer(Modifier.height(8.dp))
            ImmediateTextField("Workspace ID", config.endpoint.workspaceId) {
                controller.updateConfig { current ->
                    current.copy(endpoint = current.endpoint.copy(workspaceId = it.ifBlank { "default" }))
                }
            }
            Spacer(Modifier.height(8.dp))
            ImmediateTextField("URL", config.endpoint.url) {
                controller.updateConfig { current ->
                    current.copy(endpoint = current.endpoint.copy(url = it))
                }
            }
            Spacer(Modifier.height(8.dp))
            ImmediateTextField("API key / token", config.endpoint.apiKey) {
                controller.updateConfig { current ->
                    current.copy(endpoint = current.endpoint.copy(apiKey = it))
                }
            }
            Spacer(Modifier.height(8.dp))
            NumericField("Batch window (seconds)", config.endpoint.batchWindowSeconds) {
                controller.updateConfig { current ->
                    current.copy(endpoint = current.endpoint.copy(batchWindowSeconds = it.coerceAtLeast(1)))
                }
            }
        }

        SummaryCard(
            icon = { Icon(Icons.Outlined.Subject, null) },
            title = "Example payload",
            body = ""
        ) {
            SelectionContainer {
                Text(
                    """
                    {
                      "protocol": "presence.v2",
                      "workspaceId": "default",
                      "deviceId": "macos-macbook-pro",
                      "sessionId": "f59831db-9d3d-4ec4-9101-f3a975ad8a4b",
                      "events": [
                        {
                          "eventId": "macos-macbook-pro:42",
                          "seq": 42,
                          "kind": "snapshot",
                          "observedAt": "2026-04-01T09:00:11Z",
                          "sentAt": "2026-04-01T09:00:12Z",
                          "state": {
                            "availability": {
                              "state": "active",
                              "idleSeconds": 8
                            },
                            "focus": {
                              "state": "foreground",
                              "app": {
                                "name": "Google Chrome",
                                "id": "com.google.Chrome"
                              },
                              "page": {
                                "title": "Dashboard",
                                "url": "https://example.com/dashboard"
                              }
                            },
                            "presenceKind": "interactive",
                            "mediaSessions": [
                              {
                                "provider": {
                                  "id": "spotify",
                                  "kind": "music"
                                },
                                "item": {
                                  "type": "track",
                                  "title": "Track Name",
                                  "artist": "Artist"
                                },
                                "playback": {
                                  "state": "playing",
                                  "progressSeconds": 12.5,
                                  "durationSeconds": 180,
                                  "scope": "local"
                                }
                              }
                            ],
                            "device": {
                              "platform": "macos",
                              "appVersion": "0.1.0",
                              "deviceName": "MacBook-Pro"
                            },
                            "capabilities": {
                              "focusApp": true,
                              "focusWindow": false,
                              "browserPage": true,
                              "mediaNowPlaying": true
                            }
                          }
                        }
                      ]
                    }
                    """.trimIndent(),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun StatsTab(rows: List<UsageSummaryRow>) {
    Card(
        modifier = Modifier.fillMaxSize(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Usage statistics", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (rows.isEmpty()) {
                Text("No tracked sessions yet.")
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(rows) { row ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(row.label, fontWeight = FontWeight.Medium)
                                Text(
                                    "${row.day} · ${row.privacyMode.name.lowercase()}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(formatDuration(row.totalSeconds), fontWeight = FontWeight.SemiBold)
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun LogsTab(logs: List<ActivityLogEntry>) {
    Card(
        modifier = Modifier.fillMaxSize(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Activity log", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (logs.isEmpty()) {
                Text("No activity entries yet.")
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(logs) { log ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(log.message, fontWeight = FontWeight.Medium)
                            Text(
                                "${log.type.name.lowercase()} · ${log.recordedAt.toLocalDateTime(TimeZone.currentSystemDefault())}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            log.snapshot?.focus?.page?.title?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
    content: @Composable ColumnScope.() -> Unit = {}
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    modifier = Modifier.size(40.dp).background(
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                        RoundedCornerShape(12.dp)
                    ),
                    contentAlignment = Alignment.Center
                ) {
                    icon()
                }
                Column {
                    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (body.isNotBlank()) {
                        Text(body, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            content()
        }
    }
}

@Composable
private fun RuleRow(rule: AppRule, onRemove: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(rule.pattern, fontWeight = FontWeight.Medium)
            Text(
                "${rule.matcher.name.lowercase()} · ${rule.mode.name.lowercase()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        TextButton(onClick = onRemove) {
            Text("Remove")
        }
    }
}

@Composable
private fun LabeledSwitch(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun NumericField(label: String, value: Long, onValueAccepted: (Long) -> Unit) {
    var text by rememberSaveable(label) { mutableStateOf(value.toString()) }
    LaunchedEffect(value) {
        if (text != value.toString()) text = value.toString()
    }
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            it.toLongOrNull()?.let(onValueAccepted)
        },
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true
    )
}

@Composable
private fun ImmediateTextField(label: String, value: String, onValueAccepted: (String) -> Unit) {
    var text by rememberSaveable(label) { mutableStateOf(value) }
    LaunchedEffect(value) {
        if (text != value) text = value
    }
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            onValueAccepted(it)
        },
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> EnumSelector(
    label: String,
    selected: T,
    options: List<T>,
    onSelected: (T) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton(onClick = { expanded = true }) {
                Text(selected.toString())
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.toString()) },
                        onClick = {
                            expanded = false
                            onSelected(option)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun rememberTrayPainter(active: Boolean): BitmapPainter {
    return remember(active) {
        val image = BufferedImage(20, 20, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        g.color = java.awt.Color(0, 0, 0, 0)
        g.fillRect(0, 0, 20, 20)
        g.color = if (active) java.awt.Color(0x1B, 0x8A, 0x5A) else java.awt.Color(0x85, 0x85, 0x85)
        g.fillOval(3, 3, 14, 14)
        g.color = java.awt.Color.WHITE
        g.stroke = BasicStroke(2.2f)
        g.drawLine(6, 10, 10, 6)
        g.drawLine(10, 6, 14, 10)
        g.drawLine(14, 10, 10, 14)
        g.dispose()
        BitmapPainter(image.toComposeImageBitmap())
    }
}
