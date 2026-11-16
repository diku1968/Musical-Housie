# Musical Housie — Android Studio Project (`.aab` + AdMob Ready)

This folder is a complete Android Studio Gradle project for **Dhiren Pathak Present Musical Housie** with **Google AdMob** (Banner + Interstitial) pre-wired.

## 1. Before You Build for Google Play Store
1. **Publish the Web App** in AI Studio first so your public URL (`https://ais-pre-...`) is live.
2. Open `android/app/build.gradle.kts` and update:
   - `applicationId` (your unique Play Store package name, e.g. `com.dhirenpathak.musicalhousie`)
   - `APP_URL` (your published public URL)
   - `BANNER_AD_UNIT_ID` and `INTERSTITIAL_AD_UNIT_ID` (replace the Google test Ad Unit IDs with your real AdMob IDs)
3. Open `android/app/src/main/AndroidManifest.xml` and replace `com.google.android.gms.ads.APPLICATION_ID` with your real AdMob App ID (`ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy`).

## 2. Build `.aab` in Android Studio
1. Open the `android/` folder in **Android Studio**.
2. Wait for Gradle Sync to finish.
3. Click **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**.
4. Select or create your `.jks` signing keystore and build the **release** `.aab`.

## 3. Build `.aab` on GitHub (Included Workflow)
Push this repository to GitHub and open the **Actions** tab → run **Build Android AAB** to generate `app-release.aab` automatically in the cloud.
*(To sign the AAB inside GitHub Actions, sign it locally in Android Studio or with `jarsigner`, or upload to Google Play Console with Play App Signing.)*

## 4. Google Play + YouTube Compliance Notes
- Keep the YouTube player visible on screen (`FLAG_KEEP_SCREEN_ON` is enabled and `onPause()` stops background playback automatically).
- Keep AdMob banners outside the WebView video area (already placed in `adBannerContainer` below the game screen).
- Only call `window.AndroidBridge?.showInterstitial()` between rounds/screens — never over an active video.
