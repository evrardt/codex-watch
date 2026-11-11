plugins { id("com.android.application") }
android {
    namespace = "fr.thomas.codexwatch.pairing"
    compileSdk = 35
    defaultConfig { applicationId = "fr.thomas.codexwatch.pairing"; minSdk = 30; targetSdk = 35; versionCode = 1; versionName = "0.1" }
    if (rootProject.file(".tools/debug.keystore").exists()) signingConfigs.getByName("debug") { storeFile = rootProject.file(".tools/debug.keystore"); storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
