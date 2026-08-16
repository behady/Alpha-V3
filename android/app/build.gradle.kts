import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * Which Firebase project the app talks to.
 *
 * Read from firebase.properties (gitignored) rather than the usual
 * google-services.json, because that file requires registering an Android app in
 * the Firebase console. Everything this app uses — email sign-in and Firestore —
 * works from these five values alone, so the build has no console step.
 *
 * If the file is missing the build fails with an explanation rather than
 * producing an app that installs and then silently cannot reach the database.
 */
val firebaseProps = Properties().apply {
    val f = rootProject.file("firebase.properties")
    require(f.exists()) {
        "firebase.properties is missing from the android/ folder. It holds the Firebase " +
            "project ids. Copy them from .env.local in the website project — see README.md."
    }
    f.inputStream().use { load(it) }
}
fun firebase(key: String): String = requireNotNull(firebaseProps.getProperty(key)) {
    "firebase.properties is missing the '$key' entry."
}

// Release signing, read from keystore.properties. Falls back to the debug key so a
// fresh checkout can still build.
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.alphadental.clinic"
    compileSdk = 36

    defaultConfig {
        // Same id and signing key as the app this replaces, so it installs straight
        // over the old one instead of sitting beside it.
        applicationId = "com.alphadental.clinic"
        minSdk = 26
        targetSdk = 36
        versionCode = 38
        versionName = "4.8.1"

        buildConfigField("String", "FB_PROJECT_ID", "\"${firebase("firebase.projectId")}\"")
        buildConfigField("String", "FB_API_KEY", "\"${firebase("firebase.apiKey")}\"")
        buildConfigField("String", "FB_APP_ID", "\"${firebase("firebase.appId")}\"")
        buildConfigField("String", "FB_SENDER_ID", "\"${firebase("firebase.senderId")}\"")
        buildConfigField("String", "FB_STORAGE_BUCKET", "\"${firebase("firebase.storageBucket")}\"")

        // ====================================================================
        //  THE CLINIC'S WEB ADDRESS — the one line to change if it ever moves.
        // ====================================================================
        // Used by "Open full system", which opens a real browser tab for the
        // screens that are not native yet. Nothing else in the app depends on
        // it: patient data comes straight from Firebase, so a wrong address
        // here does not corrupt anything — it just quietly sends staff to the
        // wrong site. Which is exactly what happened, because the old preview
        // deployment still answers with a working-looking page rather than an
        // error, so nobody noticed.
        buildConfigField("String", "WEB_URL", "\"https://alpha-v3-live.vercel.app/\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    applicationVariants.all {
        outputs.all {
            val output = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            output.outputFileName = "AlphaDental-${name}-${versionName}.apk"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Opens the not-yet-native screens in a real Chrome tab rather than an
    // embedded browser — which is what makes Google sign-in and downloads work.
    implementation("androidx.browser:browser:1.8.0")

    // Firebase. Auth for sign-in, Firestore for everything else. Firestore's own
    // on-device cache is the offline engine, so there is no second database here.
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-firestore")

    // Runs the SMS poller every 15 minutes, survives reboots, and backs off with no network.
    // A plain background thread or an AlarmManager stops working the moment Android decides the
    // app is idle - which for a phone sitting in a drawer at 07:00 is always.
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")

    testImplementation("junit:junit:4.13.2")
}
