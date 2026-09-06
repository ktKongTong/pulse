package io.github.kt.pulsebar.nativehello

import kotlinx.cinterop.CName
import kotlinx.cinterop.ExperimentalForeignApi

@OptIn(ExperimentalForeignApi::class)
@CName("pulsebar_native_hello")
fun pulsebarNativeHello(): String = "Hello from Kotlin/Native"
