plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.musicalhousie.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.musicalhousie.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // Replace APP_URL with your published public web app URL if you change deployments
        buildConfigField(
            "String",
            "APP_URL",
            "\"https://ais-pre-r627uwcv5yhj5sbsayhzdv-953847587354.asia-southeast1.run.app\""
        )

        // Google AdMob Test Ad Unit IDs — replace with your real AdMob Ad Unit IDs before release
        buildConfigField(
            "String",
            "BANNER_AD_UNIT_ID",
            "\"ca-app-pub-3940256099942544/6300978111\""
        )
        buildConfigField(
            "String",
            "INTERSTITIAL_AD_UNIT_ID",
            "\"ca-app-pub-3940256099942544/1033173712\""
        )
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")

    // Google AdMob SDK
    implementation("com.google.android.gms:play-services-ads:23.6.0")
}
