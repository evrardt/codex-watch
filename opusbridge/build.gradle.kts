plugins { id("com.android.library") }
android {
    namespace = "fr.thomas.codexwatch.opusbridge"
    compileSdk = 35
    defaultConfig { minSdk = 30 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation("eu.buney.kopus:kopus-android:1.5.2") { isTransitive = false }
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.0.21")
}
