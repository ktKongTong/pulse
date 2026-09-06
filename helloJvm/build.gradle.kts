import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.jvm.tasks.Jar
import org.gradle.api.tasks.compile.JavaCompile

plugins {
    kotlin("jvm")
}

repositories {
    maven("https://maven.aliyun.com/repository/public")
    mavenCentral()
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
    sourceSets {
        main {
            kotlin.srcDir("../common/src/commonMain/kotlin/io/github/kt/pulsebar/demo")
        }
    }
}

dependencies {
    implementation(kotlin("stdlib"))
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}

tasks.register<Jar>("jvmHelloThinJar") {
    archiveFileName.set("pulsebar-kotlin-hello-thin.jar")
    dependsOn(tasks.named("jar"))
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE

    from({
        zipTree(tasks.named<Jar>("jar").get().archiveFile.get().asFile)
    }) {
        include("io/github/kt/pulsebar/demo/Hello.class")
        include("io/github/kt/pulsebar/demo/Hello\$Companion.class")
    }
    from({
        configurations.runtimeClasspath.get().map { file ->
            if (file.isDirectory) file else zipTree(file)
        }
    }) {
        include("kotlin/**")
        include("org/jetbrains/annotations/NotNull.class")
    }
}
