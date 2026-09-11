package io.github.kt.pulsebar.store.database

import androidx.room3.RoomDatabase
import java.io.File
import kotlin.jvm.functions.Function0

internal actual fun pulseBarRoomDatabaseBuilder(): RoomDatabase.Builder<PulseBarRoomDatabase> {
    val dbPath = File(
        System.getProperty("user.home"),
        "AppData/Local/PulseBar/pulsebar.room.db",
    ).apply {
        parentFile?.mkdirs()
    }.absolutePath

    val factory = object : Function0<PulseBarRoomDatabase> {
        override fun invoke(): PulseBarRoomDatabase =
            PulseBarRoomDatabaseConstructor.initialize()
    }

    // Room.databaseBuilder is an inline reified function and throws when
    // invoked reflectively. Instantiate its non-reified internal Builder
    // constructor instead, passing the concrete generated database KClass.
    val builderClass = Class.forName("androidx.room3.RoomDatabase\$Builder")
    val constructor = builderClass.declaredConstructors.first { candidate ->
        candidate.parameterTypes.size == 3
    }
    @Suppress("UNCHECKED_CAST")
    return constructor.newInstance(
        PulseBarRoomDatabase::class,
        dbPath,
        factory,
    ) as RoomDatabase.Builder<PulseBarRoomDatabase>
}
