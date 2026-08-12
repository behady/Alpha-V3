import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing is read from keystore.properties (kept out of git).
// If that file is missing the release build falls back to the debug key so a
// build never hard-fails on a fresh checkout.
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        keystorePropsFile.inputStream().use { load(it) }
    }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.alphadental.clinic"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.alphadental.clinic"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
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
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
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

    buildFeatures {
        buildConfig = true
    }

    // Give the produced file a name a human can recognise in a Downloads folder.
    applicationVariants.all {
        outputs.all {
            val output = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            output.outputFileName = "AlphaDental-${name}-${versionName}.apk"
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    // Runs the SMS poller every 15 minutes, survives reboots, and backs off when
    // the phone has no network. Doing this with a plain background thread or an
    // AlarmManager would stop working the moment Android decided the app was idle.
    implementation("androidx.work:work-runtime:2.9.1")

    // The AndroidX libraries above drag in two different Kotlin runtime
    // generations. Since Kotlin 1.8 the -jdk7/-jdk8 pieces were folded into the
    // main library, so leaving the old ones in place produces duplicate
    // classes. Pinning them to the same version puts everything on one runtime.
    constraints {
        implementation("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22")
        implementation("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22")
    }
}
