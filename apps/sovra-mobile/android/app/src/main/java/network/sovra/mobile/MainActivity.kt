package network.sovra.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import network.sovra.mobile.ble.SovraBleModule

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bleModule: SovraBleModule

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
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
    }

    fun requestBlePermissions() {
        val permissions = mutableListOf<String>()

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
