package network.sovra.mobile.push

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import network.sovra.mobile.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * SovraUnifiedPushReceiver: Zero-Google-FCM Push Connector implementing the open UnifiedPush specification
 * (`org.unifiedpush.android.connector.*` and `org.unifiedpush.android.distributor.REGISTER`).
 *
 * Works with open self-hosted / P2P distributors (e.g. ntfy, Sunup, NextPush) without Firebase / GMS.
 */
object SovraUnifiedPushHub {
    private const val PREFS_NAME = "sovra_unifiedpush_prefs"
    private const val KEY_LAST_ENDPOINT = "last_endpoint"
    private const val KEY_LAST_TOKEN = "last_token"
    const val WAKEUP_CHANNEL_ID = "sovra_unifiedpush_wakeup"

    private var activityRef: WeakReference<Activity>? = null
    private var webViewRef: WeakReference<WebView>? = null

    fun attachUi(activity: Activity, webView: WebView) {
        activityRef = WeakReference(activity)
        webViewRef = WeakReference(webView)
    }

    fun saveEndpoint(context: Context, endpoint: String, token: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_ENDPOINT, endpoint)
            .putString(KEY_LAST_TOKEN, token)
            .apply()
    }

    fun clearEndpoint(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_LAST_ENDPOINT)
            .remove(KEY_LAST_TOKEN)
            .apply()
    }

    fun getLastEndpointJson(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val endpoint = prefs.getString(KEY_LAST_ENDPOINT, "") ?: ""
        val token = prefs.getString(KEY_LAST_TOKEN, "") ?: ""
        return JSONObject().apply {
            put("endpoint", endpoint)
            put("token", token)
        }.toString()
    }

    fun emitDomEvent(eventName: String, detail: JSONObject): Boolean {
        val act = activityRef?.get() ?: return false
        val wv = webViewRef?.get() ?: return false
        val payload = detail.toString()
        act.runOnUiThread {
            wv.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('$eventName', { detail: $payload }));",
                null
            )
        }
        return true
    }
}

class SovraUnifiedPushReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
        const val ACTION_REGISTRATION_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED"
        const val ACTION_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
        const val ACTION_MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val token = intent.getStringExtra("token") ?: "default"

        when (action) {
            ACTION_NEW_ENDPOINT -> {
                val endpoint = intent.getStringExtra("endpoint") ?: return
                SovraUnifiedPushHub.saveEndpoint(context, endpoint, token)
                SovraUnifiedPushHub.emitDomEvent(
                    "sovraUnifiedPushEndpoint",
                    JSONObject().apply {
                        put("endpoint", endpoint)
                        put("token", token)
                    }
                )
            }

            ACTION_MESSAGE -> {
                val rawBytes = intent.getByteArrayExtra("bytesMessage")
                    ?: intent.getByteArrayExtra("message")
                val textMsg = intent.getStringExtra("message")
                val msgB64 = when {
                    rawBytes != null -> Base64.encodeToString(rawBytes, Base64.NO_WRAP)
                    textMsg != null -> Base64.encodeToString(textMsg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                    else -> ""
                }
                val emitted = SovraUnifiedPushHub.emitDomEvent(
                    "sovraUnifiedPushMessage",
                    JSONObject().apply {
                        put("token", token)
                        put("messageBase64", msgB64)
                        put("messageText", textMsg ?: "")
                    }
                )
                if (!emitted) {
                    postWakeupNotification(context, token)
                }
            }

            ACTION_REGISTRATION_FAILED -> {
                val message = intent.getStringExtra("message") ?: "Registration failed"
                SovraUnifiedPushHub.emitDomEvent(
                    "sovraUnifiedPushError",
                    JSONObject().apply {
                        put("token", token)
                        put("message", message)
                    }
                )
            }

            ACTION_UNREGISTERED -> {
                SovraUnifiedPushHub.clearEndpoint(context)
                SovraUnifiedPushHub.emitDomEvent(
                    "sovraUnifiedPushUnregistered",
                    JSONObject().apply {
                        put("token", token)
                    }
                )
            }
        }
    }

    private fun postWakeupNotification(context: Context, token: String) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    SovraUnifiedPushHub.WAKEUP_CHANNEL_ID,
                    "Sovereign Push Wakeup",
                    NotificationManager.IMPORTANCE_HIGH
                )
                nm.createNotificationChannel(ch)
            }
            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("unifiedPushToken", token)
            }
            val pending = PendingIntent.getActivity(
                context,
                token.hashCode(),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notif = NotificationCompat.Builder(context, SovraUnifiedPushHub.WAKEUP_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("New Sovereign Activity")
                .setContentText("Tap to sync encrypted messages from your P2P relay.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
            nm.notify(5088, notif)
        } catch (_: Exception) {}
    }
}

class SovraUnifiedPushJsBridge(private val context: Context) {
    @JavascriptInterface
    fun listDistributors(): String {
        val arr = JSONArray()
        return try {
            val pm = context.packageManager
            val query = Intent("org.unifiedpush.android.distributor.REGISTER")
            @Suppress("DEPRECATION")
            val resolvers = pm.queryBroadcastReceivers(query, PackageManager.MATCH_ALL)
            for (r in resolvers) {
                val pkg = r.activityInfo?.packageName ?: continue
                arr.put(pkg)
            }
            arr.toString()
        } catch (_: Exception) {
            "[]"
        }
    }

    @JavascriptInterface
    fun registerDistributor(distributorPackage: String, instanceToken: String): Boolean {
        return try {
            val intent = Intent("org.unifiedpush.android.distributor.REGISTER").apply {
                if (distributorPackage.isNotBlank()) {
                    setPackage(distributorPackage)
                }
                putExtra("application", context.packageName)
                putExtra("token", instanceToken.ifBlank { "sovra-default" })
                putStringArrayListExtra("features", arrayListOf("bytesMessage"))
            }
            context.sendBroadcast(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun unregisterDistributor(distributorPackage: String, instanceToken: String): Boolean {
        return try {
            val intent = Intent("org.unifiedpush.android.distributor.UNREGISTER").apply {
                if (distributorPackage.isNotBlank()) {
                    setPackage(distributorPackage)
                }
                putExtra("application", context.packageName)
                putExtra("token", instanceToken.ifBlank { "sovra-default" })
            }
            context.sendBroadcast(intent)
            SovraUnifiedPushHub.clearEndpoint(context)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun getLastEndpointJson(): String = SovraUnifiedPushHub.getLastEndpointJson(context)
}
