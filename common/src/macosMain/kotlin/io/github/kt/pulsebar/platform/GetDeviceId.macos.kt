package io.github.kt.pulsebar.platform

import platform.Foundation.NSUserName


actual fun GetDeviceId(): String {
    return "macos-${NSUserName()}"
}

actual fun GetPlatformName(): String {
    return "macos"
}

actual fun GetUserName(): String {
    return NSUserName()
}