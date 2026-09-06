pluginManagement {
    resolutionStrategy {
        eachPlugin {
            // The plugin marker artifact is not mirrored; resolve the plugin jar directly.
            if (requested.id.id == "com.google.protobuf") {
                useModule("com.google.protobuf:protobuf-gradle-plugin:${requested.version}")
            }
        }
    }
    repositories {
        maven("https://maven.aliyun.com/repository/public")
        google()
        gradlePluginPortal()
        mavenCentral()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

dependencyResolutionManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

rootProject.name = "PulseBar"

include(":common")
include(":macosApp")
include(":helloJvm")
include(":nativeHello")
include(":flowIpcDemo")

project(":common").projectDir = file("common")
project(":helloJvm").projectDir = file("helloJvm")
project(":nativeHello").projectDir = file("nativeHello")
project(":flowIpcDemo").projectDir = file("flowIpcDemo")
