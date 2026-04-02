package io.github.kt.pulsebar

import io.github.kt.pulsebar.app.AppController
import io.github.kt.pulsebar.ui.launchPulseBar
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

fun main(args: Array<String>) {
    System.setProperty("apple.awt.UIElement", "true")
    System.setProperty("apple.laf.useScreenMenuBar", "true")

    val controller = AppController()
    Runtime.getRuntime().addShutdownHook(
        Thread {
            runBlocking {
                controller.shutdown()
            }
        }
    )
    controller.start()

    val headless = args.contains("--headless") || System.getenv("PULSEBAR_HEADLESS") == "1"
    if (headless) {
        runBlocking {
            while (true) {
                delay(60_000)
            }
        }
    } else {
        launchPulseBar(controller)
    }
}
