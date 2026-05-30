package io.github.kt.pulsebar.store.database

import androidx.room3.Room
import androidx.room3.RoomDatabase
import java.io.File

internal actual fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase> {
    val dbPath = File(System.getProperty("java.io.tmpdir"), "pulsebar-jvm.room.db").absolutePath
    return Room.databaseBuilder<PulseBarRoomDatabase>(
        name = dbPath
    )
}
