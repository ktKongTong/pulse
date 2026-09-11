import org.jetbrains.kotlin.gradle.swiftexport.ExperimentalSwiftExportDsl
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinNativeCompile
import org.gradle.jvm.tasks.Jar
import org.gradle.api.tasks.compile.JavaCompile

val enableMacosTarget = providers.gradleProperty("enableMacosTarget")
    .map(String::toBoolean)
    .orElse(System.getProperty("os.name").contains("mac", ignoreCase = true))
    .get()

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.androidxRoom3)
}

kotlin {
    jvm {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_1_8)
        }
    }
    if (enableMacosTarget) {
        macosArm64()
    }

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
                implementation(libs.kermit)
                implementation(libs.okio)
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }

        val jvmMain by getting {
            dependencies {
                implementation(libs.ktor.client.cio)
            }
        }

        val jvmTest by getting {
            dependencies {
                implementation(kotlin("test-junit"))
            }
        }

        if (enableMacosTarget) {
            val macosMain by creating {
                dependencies {
                    implementation(libs.ktor.client.darwin)
                }
            }
            val macosArm64Main by getting { }
        }
    }
}

dependencies {
    add("kspJvm", libs.androidx.room3.compiler)
    if (enableMacosTarget) {
        add("kspMacosArm64", libs.androidx.room3.compiler)
    }
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

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}

tasks.register<Jar>("jvmHelloJar") {
    archiveFileName.set("pulsebar-kotlin-hello.jar")
    dependsOn("jvmJar")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        zipTree(tasks.named<Jar>("jvmJar").get().archiveFile.get().asFile)
    })
    from({
        configurations.getByName("jvmRuntimeClasspath").map { file ->
            if (file.isDirectory) file else zipTree(file)
        }
    })
    manifest {
        attributes["Main-Class"] = "io.github.kt.pulsebar.demo.HelloMainJvmKt"
    }
}

tasks.register<Jar>("jvmSharedJar") {
    archiveFileName.set("pulsebar-shared-jvm8.jar")
    dependsOn("jvmJar")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        zipTree(tasks.named<Jar>("jvmJar").get().archiveFile.get().asFile)
    })
    from({
        configurations.getByName("jvmRuntimeClasspath").map { file ->
            if (file.isDirectory) file else zipTree(file)
        }
    })
}

tasks.register<Jar>("jvmHelloThinJar") {
    archiveFileName.set("pulsebar-kotlin-hello-thin.jar")
    dependsOn(":helloJvm:jvmHelloThinJar")
    from({
        zipTree(project(":helloJvm").layout.buildDirectory.file("libs/pulsebar-kotlin-hello-thin.jar").get().asFile)
    }) {
        include("io/github/kt/pulsebar/demo/Hello.class")
        include("io/github/kt/pulsebar/demo/Hello\$Companion.class")
    }
    from({
        project(":helloJvm").configurations.getByName("runtimeClasspath").map { file ->
            if (file.isDirectory) file else zipTree(file)
        }
    }) {
        include("kotlin/**")
        include("org/jetbrains/annotations/NotNull.class")
    }
}
