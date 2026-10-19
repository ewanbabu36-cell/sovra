package network.sovra.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import network.sovra.mobile.ble.SovraBleModule

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bleModule: SovraBleModule
    private var callWakeLock: PowerManager.WakeLock? = null

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
        private const val CALL_NOTIFICATION_CHANNEL_ID = "sovra_incoming_calls"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Make activity full-screen immersive with dark background matching app.json
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        )
        window.statusBarColor = Color.parseColor("#090d16")
        window.navigationBarColor = Color.parseColor("#090d16")

        // WhatsApp-Grade: Allow activity to wake screen and display directly over lockscreen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )

        createCallNotificationChannel()

        bleModule = (application as MainApplication).bleModule

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#090d16"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
            }

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    super.onReceivedError(view, request, error)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.grant(request.resources)
                }
            }
        }

        // Bridge native Android BLE module directly into web JavaScript runtime
        val bridge = SovraBleJsBridge(this, bleModule, webView)
        webView.addJavascriptInterface(bridge, "SovraBleNative")

        // Bridge native Android Call & Lockscreen Notifications
        val callBridge = SovraCallJsBridge(this)
        webView.addJavascriptInterface(callBridge, "SovraCallNative")

        // Forward native asynchronous BLE events to window event listeners in web runtime
        bleModule.onDeviceDiscovered = { address, rssi, serviceData, name ->
            val b64 = Base64.encodeToString(serviceData, Base64.NO_WRAP)
            val json = org.json.JSONObject().apply {
                put("address", address)
                put("rssi", rssi)
                put("serviceData", b64)
                put("name", name ?: ("Peer " + address.take(8)))
            }
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('onDeviceDiscovered', { detail: $json }));",
                    null
                )
            }
        }

        bleModule.onIncomingDataReceived = { gattId, data ->
            val b64 = Base64.encodeToString(data, Base64.NO_WRAP)
            val json = org.json.JSONObject().apply {
                put("gattId", gattId)
                put("data", b64)
            }
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('onIncomingDataReceived', { detail: $json }));",
                    null
                )
            }
        }

        bleModule.onPeerDisconnected = { gattId ->
            val json = org.json.JSONObject().apply {
                put("gattId", gattId)
            }
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('onPeerDisconnected', { detail: $json }));",
                    null
                )
            }
        }

        setContentView(webView)

        // Request modern Bluetooth & Location permissions
        requestBlePermissions()

        // Load offline packaged application bundle
        webView.loadUrl("file:///android_asset/index.html")

        // Handle auto-answer or decline intents on launch
        handleCallIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallIntent(intent)
    }

    private fun handleCallIntent(intent: Intent?) {
        if (intent == null) return
        val autoAnswerCallId = intent.getStringExtra("autoAnswerCall")
        val declineCallId = intent.getStringExtra("declineCall")

        if (!autoAnswerCallId.isNullOrEmpty()) {
            dismissIncomingCallSystemNotification(autoAnswerCallId)
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.autoAnswerIncomingCallById && window.autoAnswerIncomingCallById('$autoAnswerCallId');",
                    null
                )
            }
        } else if (!declineCallId.isNullOrEmpty()) {
            dismissIncomingCallSystemNotification(declineCallId)
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.declineIncomingCall && window.declineIncomingCall();",
                    null
                )
            }
        }
    }

    private fun createCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Incoming Calls"
            val descriptionText = "High-priority full-screen incoming call notifications"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CALL_NOTIFICATION_CHANNEL_ID, name, importance).apply {
                description = descriptionText
                enableLights(true)
                lightColor = Color.GREEN
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 500, 250, 500)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build()
                setSound(ringtoneUri, audioAttributes)
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun displayIncomingCallSystemNotification(callId: String, callerName: String, callType: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Wake screen with PowerManager WakeLock
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (callWakeLock == null) {
                @Suppress("DEPRECATION")
                callWakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "sovra:incoming_call_wakelock"
                )
            }
            if (callWakeLock?.isHeld == false) {
                callWakeLock?.acquire(45000) // 45 seconds timeout
            }
        } catch (_: Exception) {}

        // Intent to accept call
        val acceptIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("autoAnswerCall", callId)
            putExtra("callType", callType)
        }
        val acceptPendingIntent = PendingIntent.getActivity(
            this,
            callId.hashCode() + 1,
            acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Intent to decline call
        val declineIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("declineCall", callId)
        }
        val declinePendingIntent = PendingIntent.getActivity(
            this,
            callId.hashCode() + 2,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Full-screen incoming call intent for lockscreen display
        val fullScreenIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("incomingCallId", callId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            callId.hashCode(),
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

        val notification = NotificationCompat.Builder(this, CALL_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming " + (if (callType == "video") "Video" else "Voice") + " Call")
            .setContentText("$callerName is calling you on Sovra...")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(ringtoneUri)
            .setVibrate(longArrayOf(0, 500, 250, 500, 250, 500, 250, 500))
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_call, "🟢 Accept", acceptPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "🔴 Decline", declinePendingIntent)
            .build()

        notificationManager.notify(callId.hashCode(), notification)
    }

    fun dismissIncomingCallSystemNotification(callId: String?) {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (callId != null) {
                notificationManager.cancel(callId.hashCode())
            } else {
                notificationManager.cancelAll()
            }
        } catch (_: Exception) {}

        try {
            if (callWakeLock?.isHeld == true) {
                callWakeLock?.release()
                callWakeLock = null
            }
        } catch (_: Exception) {}
    }

    fun requestBlePermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
            }
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    fun requestEnableBluetooth() {
        try {
            val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            startActivity(enableBtIntent)
        } catch (e: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            } catch (e2: Exception) {}
        }
    }

    fun openAppSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        } catch (e: Exception) {}
    }

    fun openLocationSettings() {
        try {
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        } catch (e: Exception) {}
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (allGranted) {
                runOnUiThread {
                    webView.evaluateJavascript("if (typeof initBleNative === 'function') { initBleNative(); }", null)
                }
            }
        }
    }

    override fun onBackPressed() {
        webView.evaluateJavascript(
            "(function() { if (typeof activeRecipient !== 'undefined' && activeRecipient !== null) { closeThread(); return 'closed'; } return 'none'; })()"
        ) { result ->
            if (result != "\"closed\"") {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    super.onBackPressed()
                }
            }
        }
    }
}

class SovraBleJsBridge(
    private val activity: MainActivity,
    private val bleModule: SovraBleModule,
    private val webView: WebView
) {
    @JavascriptInterface
    fun isAvailable(): Boolean = bleModule.isAvailable()

    @JavascriptInterface
    fun isBluetoothEnabled(): Boolean = bleModule.isBluetoothEnabled()

    @JavascriptInterface
    fun hasPermissions(): Boolean = bleModule.hasPermissions()

    @JavascriptInterface
    fun isLocationEnabled(): Boolean = bleModule.isLocationEnabled()

    @JavascriptInterface
    fun requiresLocationServices(): Boolean = bleModule.requiresLocationServices()

    @JavascriptInterface
    fun requestPermissions() {
        activity.runOnUiThread {
            activity.requestBlePermissions()
        }
    }

    @JavascriptInterface
    fun requestEnableBluetooth() {
        activity.runOnUiThread {
            activity.requestEnableBluetooth()
        }
    }

    @JavascriptInterface
    fun openAppSettings() {
        activity.runOnUiThread {
            activity.openAppSettings()
        }
    }

    @JavascriptInterface
    fun openLocationSettings() {
        activity.runOnUiThread {
            activity.openLocationSettings()
        }
    }

    @JavascriptInterface
    fun startAdvertising(serviceUuid: String, dataBase64: String): Boolean {
        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: Exception) {
            ByteArray(0)
        }
        val username = try {
            String(bytes, Charsets.UTF_8).trim()
        } catch (e: Exception) {
            ""
        }
        var success = true
        bleModule.startAdvertising(serviceUuid, bytes, username) { ok, _ ->
            success = ok
        }
        return success
    }

    @JavascriptInterface
    fun stopAdvertising() {
        bleModule.stopAdvertising()
    }

    @JavascriptInterface
    fun startScanning(serviceUuid: String): Boolean {
        var success = true
        bleModule.startScanning(serviceUuid) { ok, _ ->
            success = ok
        }
        return success
    }

    @JavascriptInterface
    fun stopScanning() {
        bleModule.stopScanning()
    }

    @JavascriptInterface
    fun sendData(targetAddress: String, dataBase64: String): Boolean {
        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: Exception) {
            ByteArray(0)
        }
        bleModule.sendDataToAddress(targetAddress, bytes)
        return true
    }

    @JavascriptInterface
    fun broadcastData(dataBase64: String): Boolean {
        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: Exception) {
            ByteArray(0)
        }
        bleModule.broadcastDataToDiscoveredPeers(bytes)
        return true
    }

    @JavascriptInterface
    fun connectGatt(targetAddress: String): Boolean {
        var initiated = true
        bleModule.connectGatt(targetAddress) { ok, gattId, mtu, _ ->
            if (ok && gattId != null) {
                activity.runOnUiThread {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('onGattConnected', { detail: { gattId: '$gattId', address: '$targetAddress', mtu: $mtu } }));",
                        null
                    )
                }
            }
        }
        return initiated
    }

    @JavascriptInterface
    fun disconnectGatt(gattId: String) {
        bleModule.disconnectGatt(gattId)
    }

    @JavascriptInterface
    fun writeCharacteristic(gattId: String, dataBase64: String): Boolean {
        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: Exception) {
            ByteArray(0)
        }
        var success = true
        bleModule.writeCharacteristic(gattId, bytes) { ok, _ ->
            success = ok
        }
        return success
    }
}

class SovraCallJsBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun showIncomingCallNotification(callId: String, callerName: String, callType: String) {
        activity.runOnUiThread {
            activity.displayIncomingCallSystemNotification(callId, callerName, callType)
        }
    }

    @JavascriptInterface
    fun cancelIncomingCallNotification(callId: String) {
        activity.runOnUiThread {
            activity.dismissIncomingCallSystemNotification(callId)
        }
    }
}
