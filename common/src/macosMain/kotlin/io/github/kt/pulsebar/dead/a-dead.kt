package io.github.kt.pulsebar.dead
//
//import io.github.kt.pulsebar.export.PulseBarSnapshot
//import io.github.kt.pulsebar.export.SessionParts
//import io.github.kt.pulsebar.export.SessionState
//import io.github.kt.pulsebar.export.parseSessionParts
//import io.github.kt.pulsebar.utils.nowInMillis
//
//private fun updateUsage(snapshot: PulseBarSnapshot) {
//    val nowMillis = nowInMillis()
//    val day = todayKey()
//    val label = buildString {
//        append(snapshot.appName)
//        snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
//            append(" / ")
//            append(it)
//        }
//    }
//    val statKey = buildString {
//        append(snapshot.bundleId)
//        snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
//            append("::")
//            append(it)
//        }
//        snapshot.media?.trackId?.takeIf { it.isNotBlank() }?.let {
//            append("::media:")
//            append(it)
//        }
//    }
//    val signature = buildString {
//        append(snapshot.bundleId)
//        append("::")
//        append(snapshot.pageTitle ?: "")
//        append("::")
//        append(snapshot.media?.trackId ?: snapshot.media?.title ?: "")
//    }
//
//    currentSession?.let { session ->
//        val deltaMillis = (nowMillis - (lastObservedAtMillis ?: session.startedAtMillis)).coerceAtLeast(0L)
//        val accumulatedMillis = pendingElapsedMillis + deltaMillis
//        val elapsedSeconds = (accumulatedMillis / 1000L).toInt()
//        pendingElapsedMillis = accumulatedMillis % 1000L
//        if (elapsedSeconds > 0) {
//            store.incrementUsage(
//                day = day,
//                key = session.statKey,
//                label = session.label,
//                seconds = elapsedSeconds
//            )
//        }
//    }
//
//    if (currentSession?.signature != signature) {
//        currentSession?.let { previous ->
//            val previousParts = parseSessionParts(previous)
//            val nextParts = SessionParts(
//                bundleId = snapshot.bundleId,
//                pageTitle = snapshot.pageTitle,
//                mediaKey = snapshot.media?.trackId ?: snapshot.media?.title
//            )
//            val streakSeconds = ((nowMillis - previous.startedAtMillis).coerceAtLeast(0L) / 1000L).toInt()
//            store.updateMaxCounter(day, "longest_focus_streak_seconds", streakSeconds)
//            store.incrementCounter(day, "session_count")
//            if (previousParts.bundleId != nextParts.bundleId) {
//                store.incrementCounter(day, "focus_switch_count")
//            }
//            if (previousParts.pageTitle != nextParts.pageTitle) {
//                store.incrementCounter(day, "page_switch_count")
//            }
//            if (previousParts.mediaKey != nextParts.mediaKey && !previousParts.mediaKey.isNullOrBlank()) {
//                store.incrementCounter(day, "media_switch_count")
//            }
//        } ?: store.incrementCounter(day, "session_count")
//        currentSession = SessionState(
//            signature = signature,
//            statKey = statKey,
//            label = label,
//            startedAtMillis = nowMillis
//        )
//        pendingElapsedMillis = 0L
//    }
//
//    lastObservedAtMillis = nowMillis
//}