package io.github.kt.pulsebar.store.config

import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.okio.OkioStorage
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okio.FileSystem
import okio.Path

/**
 * Typed DataStore wrapping a single JSON-serialized [PulseBarConfigProto]
 * file. The platform layer supplies the file location via
 * [pulseBarConfigPath].
 *
 * This store is the only source of truth for config in Phase 2+. Legacy
 * `NSUserDefaults` keys and the old `config.json` format are not consulted.
 *
 * The primary consumer surface is [configFlow], a hot [Flow] that emits on any
 * persisted change. Callers that need a synchronous snapshot for Swift-facing
 * APIs can use [snapshot] — but they should prefer collecting the flow.
 */
internal class PulseBarConfigStore(
    fileSystem: FileSystem,
    path: Path,
    serializer: PulseBarConfigSerializer = PulseBarConfigSerializer(),
) {
    private val log = logger(PulseLogCategory.ConfigStore)

    private val dataStore: DataStore<PulseBarConfigProto> = DataStoreFactory.create(
        storage = OkioStorage(
            fileSystem = fileSystem,
            serializer = serializer,
            producePath = { path },
        ),
    )

    /**
     * Hot stream of the persisted config. Emits the current value on subscribe
     * and again after every successful [update]. Duplicate values are
     * filtered so reactors only wake when something actually changes.
     */
    val configFlow: Flow<PulseBarConfigProto> = dataStore.data.distinctUntilChanged()

    /**
     * Suspending read-once. Preferred from coroutine scopes over [snapshot].
     */
    suspend fun current(): PulseBarConfigProto = dataStore.data.first()

    /**
     * Suspending atomic update. The [transform] receives the current value
     * and returns the next one. The resulting value is normalized before it
     * hits disk so subscribers never see malformed records.
     */
    suspend fun update(
        transform: suspend (PulseBarConfigProto) -> PulseBarConfigProto,
    ): PulseBarConfigProto {
        val updated = dataStore.updateData { current ->
            transform(current)
        }
        log.d {
            "config.persisted schemaVersion=${updated.schemaVersion}" +
                " endpoints=${updated.data.endpoints.size}"
        }
        return updated
    }

    /**
     * Blocking variant of [current] for platform entry points that can't
     * suspend (the `PulseBarBridge` readers exposed to Swift Export). Reads
     * the cached latest value; the `runBlocking` only suspends on the first
     * load before the file has been read into memory.
     */
    fun snapshot(): PulseBarConfigProto = runBlocking { current() }

    /**
     * Blocking variant of [update] for the same Swift-facing path. Returns
     * the normalized value that was persisted.
     */
    fun replace(value: PulseBarConfigProto): PulseBarConfigProto =
        runBlocking { update { value } }
}

internal expect fun pulseBarConfigPath(): Path
internal expect fun pulseBarConfigFileSystem(): FileSystem
