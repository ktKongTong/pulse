import org.jetbrains.kotlin.gradle.swiftexport.ExperimentalSwiftExportDsl
import org.jetbrains.kotlin.gradle.tasks.KotlinNativeCompile

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.androidxRoom3)
}

kotlin {
    jvm()
    macosArm64()

    @OptIn(ExperimentalSwiftExportDsl::class)
    swiftExport {
        moduleName = "PulseBarShared"
        flattenPackage = "io.github.kt.pulsebar.export"
        configure {
            freeCompilerArgs.addAll(
                "-Xexpect-actual-classes",
                "-opt-in=kotlin.time.ExperimentalTime",
                "-opt-in=kotlinx.coroutines.InternalCoroutinesApi",
            )
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(libs.androidx.room3.runtime)
                implementation(libs.androidx.sqlite.bundled)
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.websockets)
                implementation(libs.androidx.datastore.core)
                implementation(libs.androidx.datastore.core.okio)
                implementation(libs.okio)
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }

        val jvmTest by getting {
            dependencies {
                implementation(kotlin("test-junit"))
            }
        }

        val macosMain by creating {
            dependencies {
                implementation(libs.ktor.client.darwin)
            }
        }
        val macosArm64Main by getting { }
    }
}

dependencies {
    add("kspJvm", libs.androidx.room3.compiler)
    add("kspMacosArm64", libs.androidx.room3.compiler)
}

room3 {
    schemaDirectory("$projectDir/schemas")
}

tasks.withType<KotlinNativeCompile>().configureEach {
    if (name.startsWith("compileSwiftExport")) {
        compilerOptions.optIn.addAll(
            "-Xexpect-actual-classes",
            "kotlin.time.ExperimentalTime",
            "kotlinx.coroutines.InternalCoroutinesApi",
        )
    }
}
