package network.sovra.mobile.update

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * SovraUpdaterJsBridge: Defense-in-depth native Android OTA verifier and installer launcher.
 * Verifies ZIP magic header and SHA-256 checksum inside native Kotlin before writing private
 * cacheDir/updates/sovra-verified-update.apk and invoking OS PackageInstaller via FileProvider.
 */
class SovraUpdaterJsBridge(private val activity: Activity) {
    @JavascriptInterface
    fun canRequestPackageInstalls(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    @JavascriptInterface
    fun verifyAndInstallApkBase64(apkBase64: String, expectedSha256Hex: String): String {
        val result = JSONObject()
        return try {
            val cleanExpected = expectedSha256Hex.trim().lowercase()
            if (cleanExpected.length != 64) {
                throw IllegalArgumentException("Expected 64-char SHA-256 hex digest")
            }
            val apkBytes = Base64.decode(apkBase64, Base64.DEFAULT)
            if (apkBytes.size < 4 || apkBytes[0] != 0x50.toByte() || apkBytes[1] != 0x4B.toByte()) {
                throw IllegalArgumentException("Payload is not a valid APK ZIP archive")
            }
            val actualHex = MessageDigest.getInstance("SHA-256")
                .digest(apkBytes)
                .joinToString("") { "%02x".format(it) }
            if (!actualHex.equals(cleanExpected, ignoreCase = true)) {
                throw SecurityException("Native APK SHA-256 mismatch: expected $cleanExpected, got $actualHex")
            }

            val updatesDir = File(activity.cacheDir, "updates").apply { mkdirs() }
            val apkFile = File(updatesDir, "sovra-verified-update.apk")
            apkFile.writeBytes(apkBytes)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                val permIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                activity.startActivity(permIntent)
                result.put("ok", false)
                result.put("permissionRequired", true)
                result.put("sha256Hex", actualHex)
                return result.toString()
            }

            val contentUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                apkFile
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(installIntent)

            result.put("ok", true)
            result.put("launched", true)
            result.put("sha256Hex", actualHex)
            result.toString()
        } catch (e: Exception) {
            result.put("ok", false)
            result.put("error", e.message ?: e.javaClass.simpleName)
            result.toString()
        }
    }
}
