package io.github.kt.pulsebar.platform

import java.util.UUID

actual fun GetDeviceId(): String {
    val seed = listOf(
        System.getProperty("user.home").orEmpty(),
        System.getProperty("os.name").orEmpty(),
        System.getProperty("os.arch").orEmpty(),
    ).joinToString("|")
    return UUID.nameUUIDFromBytes(seed.toByteArray()).toString()
}

actual fun GetUserName(): String =
    System.getProperty("user.name").orEmpty()

actual fun GetPlatformName(): String =
    System.getProperty("os.name").orEmpty()