// AGP 9 supplies built-in Kotlin. Upgrade its runtime KGP without applying kotlin-android.
// https://developer.android.com/build/releases/agp-9-0-0-release-notes#upgrade-to-a-higher-kgp-version
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}
plugins {
    id("com.android.application") version "9.1.1" apply false
}
