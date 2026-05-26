package io.github.kt.pulsebar.export


internal val excludedStatsBundleIds = setOf(
    "io.github.kt.pulsebar.native",
    "com.apple.FollowUpUI",
    "com.apple.loginwindow"
)

internal enum class UsageSlice {
    APP,
    PAGE,
    MEDIA
}
