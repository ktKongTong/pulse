package io.github.kt.pulsebar.store.database

import androidx.room3.RoomDatabase
import java.io.File
import kotlin.jvm.functions.Function0

internal actual fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase> {
    val dbPath = File(System.getProperty("java.io.tmpdir"), "pulsebar-jvm.room.db").absolutePath
    val roomClass = Class.forName("androidx.room3.Room")
    val room = roomClass.getField("INSTANCE").get(null)
    val databaseBuilder = roomClass.methods.first { method ->
        method.name == "databaseBuilder" &&
            method.parameterTypes.size == 2 &&
            method.parameterTypes[0] == String::class.java
    }
    val factory = object : Function0<PulseBarRoomDatabase> {
        override fun invoke(): PulseBarRoomDatabase {
            return PulseBarRoomDatabaseConstructor.initialize()
        }
    }
    @Suppress("UNCHECKED_CAST")
    return databaseBuilder.invoke(room, dbPath, factory) as RoomDatabase.Builder<PulseBarRoomDatabase>
}
