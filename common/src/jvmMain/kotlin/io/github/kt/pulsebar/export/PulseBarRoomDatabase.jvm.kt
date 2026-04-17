package io.github.kt.pulsebar.export

import androidx.room.Room
import androidx.room.RoomDatabase
import java.io.File

internal actual fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase> {
    val dbPath = File(System.getProperty("java.io.tmpdir"), "pulsebar-jvm.room.db").absolutePath
    return Room.databaseBuilder<PulseBarRoomDatabase>(
        name = dbPath
    )
}
