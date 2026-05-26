package io.github.kt.pulsebar.export

//    private suspend fun runTick(forcePublish: Boolean, forceReplay: Boolean) {
//        tickMutex.withLock {
//            val config = currentConfig()
//            val snapshot = readSnapshot()
//            updateUsage(snapshot)
//            reporter.capture(snapshot, config)
//            if (forceReplay) {
//                reporter.sync(config, forceReplay = true)
//            } else {
//                reporter.sync(config)
//            }
//            if (forcePublish) {
//                // capture() is a no-op when nothing changed; force a push anyway.
//                reporter.forceSync(snapshot, config)
//            }
//            val rows = store.topRowsForDay(todayKey(), 3)
//            publishMenuState(
//                PulseBarMenuState(
//                    snapshot = snapshot,
//                    firstUsage = rows.getOrNull(0),
//                    secondUsage = rows.getOrNull(1),
//                    thirdUsage = rows.getOrNull(2),
//                ),
//            )
//        }
//    }

//    private fun publishMenuState(next: PulseBarMenuState) {
//        latestMenuState = next
//        menuStateFlow.value = next
//        syncStateFlow.value = reporter.readSyncState(currentConfig())
//        interactionStateFlow.value = emptyInteractionState()
//    }

//eventBus.emit(NativeNowPlayingChanged(
//media = StreamMedia(
//providerId = providerId?.ifBlank { null },
//trackId = trackId?.ifBlank { null },
//title = title?.ifBlank { null },
//artist = artist?.ifBlank { null },
//album = album?.ifBlank { null },
//artworkUrl = artworkUrl?.ifBlank { null },
//progressSeconds = progressSeconds.coerceAtLeast(0.0),
//durationSeconds = durationSeconds.takeIf { it > 0.0 },
//playbackState = if (isPlaying) StreamPlaybackWire.PLAYING
//else StreamPlaybackWire.PAUSED,
//),
//observedAtMillis = TODO()
//))