plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "fr.thomas.codexwatch"
    compileSdk = 35
    defaultConfig {
        applicationId = "fr.thomas.codexwatch"
        minSdk = 30
        targetSdk = 35
        versionCode = 74
        versionName = "0.12.50"
    }
    buildFeatures { compose = true }
    if (rootProject.file(".tools/debug.keystore").exists()) signingConfigs.getByName("debug") {
        storeFile = rootProject.file(".tools/debug.keystore")
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
    val releaseStore = System.getenv("WATCH_KEYSTORE")
    if (!releaseStore.isNullOrBlank()) {
        signingConfigs.create("release") {
            storeFile = file(releaseStore)
            storePassword = System.getenv("WATCH_STORE_PASSWORD")
            keyAlias = System.getenv("WATCH_KEY_ALIAS") ?: "codexwatch"
            keyPassword = System.getenv("WATCH_KEY_PASSWORD")
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("release")
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(":opusbridge"))
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.wear.compose:compose-foundation:1.4.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("org.commonmark:commonmark:0.30.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.30.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.30.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
