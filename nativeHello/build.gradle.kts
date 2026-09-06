plugins {
    kotlin("multiplatform")
}

kotlin {
    mingwX64 {
        binaries {
            sharedLib {
                baseName = "PulseBar.NativeHello"
            }
        }
    }
}
