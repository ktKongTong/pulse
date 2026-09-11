import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
    id("com.google.protobuf") version "0.10.0"
}

// Spike-only versions, deliberately kept out of the shared version catalog.
val grpcVersion = "1.84.0"
val grpcKotlinVersion = "1.5.0"
val protobufVersion = "4.36.1"

kotlin {
    compilerOptions {
        // The daemon runs on a modern bundled JDK; no IKVM-era JVM 1.8 constraint here.
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}

dependencies {
    implementation(project(":common"))
    implementation(libs.kotlinx.coroutines.core)
    implementation("io.grpc:grpc-kotlin-stub:$grpcKotlinVersion")
    implementation("io.grpc:grpc-protobuf:$grpcVersion")
    implementation("io.grpc:grpc-stub:$grpcVersion")
    implementation("io.grpc:grpc-netty-shaded:$grpcVersion")
    implementation("com.google.protobuf:protobuf-kotlin:$protobufVersion")

    testImplementation(kotlin("test-junit"))
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
    plugins {
        create("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion"
        }
        create("grpckt") {
            artifact = "io.grpc:protoc-gen-grpc-kotlin:$grpcKotlinVersion:jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach { task ->
            task.plugins {
                create("grpc")
                create("grpckt")
            }
            task.builtins {
                create("kotlin")
            }
        }
    }
}

tasks.register<JavaExec>("runDaemon") {
    group = "flow ipc demo"
    description = "Starts the demo daemon on 127.0.0.1:56180 for the .NET client."
    mainClass.set("io.github.kt.pulsebar.flowipc.DaemonMainKt")
    classpath = sourceSets["main"].runtimeClasspath
}
