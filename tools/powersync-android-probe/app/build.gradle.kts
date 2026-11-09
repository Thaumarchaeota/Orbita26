plugins {
    id("com.android.application")
}

android {
    namespace = "dev.orbita.powersyncprobe"
    compileSdk = 37
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "dev.orbita.powersyncprobe"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "synthetic-probe-1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        debug { isMinifyEnabled = false }
        release { isMinifyEnabled = false }
    }
}

dependencies {
    implementation("com.powersync:core:1.16.0") { version { strictly("1.16.0") } }
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.4.21") { version { strictly("2.4.21") } }
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    // SqliteRow.jsonValues exposes this type; the SDK's Ktor JSON dependency is runtime-scoped.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0") { version { strictly("1.11.0") } }
    constraints {
        implementation("com.powersync:common:1.16.0") { version { strictly("1.16.0") } }
        implementation("com.powersync:powersync-sqlite-core:0.5.4") { version { strictly("0.5.4") } }
    }
}
