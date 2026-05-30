package io.github.kt.pulsebar.store.database

import io.github.kt.pulsebar.store.database.model.*
import androidx.room3.ConstructedBy
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.RoomDatabaseConstructor
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json



@Database(
    version = 2,
    exportSchema = true,
    entities = [
        AppEntity::class,
        FocusSpanEntity::class,
    ]
)
@ConstructedBy(PulseBarRoomDatabaseConstructor::class)
internal abstract class PulseBarRoomDatabase : RoomDatabase() {
    abstract fun usageDao(): PulseBarUsageDao
}

@Suppress("KotlinNoActualForExpect")
internal expect object PulseBarRoomDatabaseConstructor : RoomDatabaseConstructor<PulseBarRoomDatabase> {
    override fun initialize(): PulseBarRoomDatabase
}

internal expect fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase>

internal object PulseBarRoomProvider {
    val json: Json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    val database: PulseBarRoomDatabase by lazy {
        pulseBarRoomDatabaseBuilder()
            .setDriver(BundledSQLiteDriver())
            .setQueryCoroutineContext(Dispatchers.Default)
            .fallbackToDestructiveMigration()
            .build()
    }
}
