package io.github.kt.pulsebar.platform


expect fun GetDeviceId(): String
expect fun GetPlatformName(): String
expect fun GetUserName(): String

enum class Platform {
    MacOS,
    Linux,
    Windows,
    Android,
    Unknown;
}

data class PlatformDevice(
    val name: String,
    val os: Platform,
    val arch: String,
    val distribution: String?,
)

//expect fun GetDeviceInfo(): PlatformDevice