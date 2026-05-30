package io.github.kt.pulsebar.config

import okio.FileSystem
import okio.Path
import okio.Path.Companion.toPath
import java.io.File

internal actual fun pulseBarConfigPath(): Path {
    val directory = File(System.getProperty("java.io.tmpdir"), "pulsebar")
    directory.mkdirs()
    return File(directory, "config.v1.json").absolutePath.toPath()
}

internal actual fun pulseBarConfigFileSystem(): FileSystem = FileSystem.SYSTEM
