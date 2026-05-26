package io.github.kt.pulsebar.platform

import kotlinx.serialization.Serializable


@Serializable
data class App(
    val name: String? = null,
    val id: String? = null,
    val category: String? = null,
)

internal expect fun getFrontmostApp(): App
