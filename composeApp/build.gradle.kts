import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvm("desktop")

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(project(":common"))
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.ui)
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.ktor.client.core)
            }
        }

        val desktopMain by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                implementation(compose.materialIconsExtended)
                implementation(libs.kotlinx.coroutines.swing)
                implementation(libs.ktor.client.cio)
                implementation(libs.ktor.client.websockets)
                implementation(libs.ktor.client.content.negotiation)
                implementation(libs.ktor.client.logging)
                implementation(libs.ktor.serialization.kotlinx.json)
                implementation(libs.slf4j.simple)
            }
        }

        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.junit.jupiter)
            }
        }
    }
}

compose.desktop {
    application {
        mainClass = "io.github.kt.pulsebar.MainKt"
        jvmArgs(
            "-Dapple.awt.UIElement=true",
            "-Dapple.laf.useScreenMenuBar=true"
        )

        nativeDistributions {
            targetFormats(TargetFormat.Dmg)
            packageName = "PulseBar"
            packageVersion = "1.0.0"

            macOS {
                bundleID = "io.github.kt.pulsebar"
                infoPlist {
                    extraKeysRawXml = """
                        <key>LSUIElement</key>
                        <true/>
                        <key>LSMinimumSystemVersion</key>
                        <string>14.0</string>
                    """.trimIndent()
                }
            }
        }
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
