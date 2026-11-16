# Keep JavascriptInterface bridge methods in release AAB builds
-keepattributes JavascriptInterface
-keepclassmembers class com.musicalhousie.app.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
