package io.github.kt.pulsebar.store.config

import kotlinx.cinterop.ExperimentalForeignApi
import okio.FileSystem
import okio.Path
import okio.Path.Companion.toPath
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory

private const val CONFIG_DIRECTORY = "Library/Application Support/PulseBar"
private const val CONFIG_FILE = "config.v1.json"

@OptIn(ExperimentalForeignApi::class)
internal actual fun pulseBarConfigPath(): Path {
    val home = NSHomeDirectory()
    val directory = "$home/$CONFIG_DIRECTORY"
    NSFileManager.defaultManager.createDirectoryAtPath(
        path = directory,
        withIntermediateDirectories = true,
        attributes = null,
        error = null,
    )
    return "$directory/$CONFIG_FILE".toPath()
}

internal actual fun pulseBarConfigFileSystem(): FileSystem = FileSystem.SYSTEM
