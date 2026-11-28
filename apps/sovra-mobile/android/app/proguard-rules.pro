# ProGuard / R8 release shrinking & obfuscation rules for Sovra Android
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep Capacitor core plugin & WebView JavascriptInterface bridges
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class network.sovra.mobile.** { *; }
