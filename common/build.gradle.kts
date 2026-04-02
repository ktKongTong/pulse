import org.jetbrains.kotlin.gradle.swiftexport.ExperimentalSwiftExportDsl

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    jvm()
    macosArm64()

    @OptIn(ExperimentalSwiftExportDsl::class)
    swiftExport {
        moduleName = "PulseBarShared"
        flattenPackage = "io.github.kt.pulsebar.export"
        configure {
            freeCompilerArgs.add("-Xexpect-actual-classes")
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(libs.kotlinx.datetime)
                implementation(libs.kotlinx.serialization.json)
            }
        }

        val macosMain by creating {
            dependsOn(commonMain)
        }
        val macosArm64Main by getting { dependsOn(macosMain) }
    }
}
