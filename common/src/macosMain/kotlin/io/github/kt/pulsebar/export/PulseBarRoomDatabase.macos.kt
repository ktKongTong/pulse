package io.github.kt.pulsebar.export

import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory

@OptIn(ExperimentalForeignApi::class)
internal actual fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase> {
    val rootPath = NSHomeDirectory() + "/Library/Application Support/PulseBar"
    NSFileManager.defaultManager.createDirectoryAtPath(
        path = rootPath,
        withIntermediateDirectories = true,
        attributes = null,
        error = null
    )
    return Room.databaseBuilder<PulseBarRoomDatabase>(
        name = "$rootPath/pulsebar.room.db"
    )
}
