package network.sovra.mobile.ble

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * SovraBleReactModule: React Native Bridge for Genuine Android Bluetooth Low Energy Mesh Radio.
 *
 * Connects the TypeScript / React Native runtime to SovraBleModule:
 * - Scanning & Advertising
 * - GATT Client & Server 512-MTU Data Channel
 * - Event Dispatcher for Peer Discovery, Data Reception, and Disconnections
 */
class SovraBleReactModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val bleModule = SovraBleModule(reactContext)

    companion object {
        const val NAME = "SovraBleNative"
        const val TAG = "SovraBleReactModule"
    }

    override fun getName(): String = NAME

    init {
        // Forward native BLE callbacks to React Native JavaScript event emitter
        bleModule.onDeviceDiscovered = { address, rssi, serviceData, name ->
            val params = Arguments.createMap().apply {
                putString("address", address)
                putInt("rssi", rssi)
                putString("serviceData", Base64.encodeToString(serviceData, Base64.NO_WRAP))
                putString("name", name ?: "")
            }
            sendEvent("onDeviceDiscovered", params)
        }

        bleModule.onIncomingDataReceived = { gattId, data ->
            val params = Arguments.createMap().apply {
                putString("gattId", gattId)
                putString("data", Base64.encodeToString(data, Base64.NO_WRAP))
            }
            sendEvent("onIncomingDataReceived", params)
        }

        bleModule.onPeerDisconnected = { gattId ->
            val params = Arguments.createMap().apply {
                putString("gattId", gattId)
            }
            sendEvent("onPeerDisconnected", params)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } else {
            Log.d(TAG, "React instance inactive, dropped event: $eventName")
        }
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            val available = bleModule.isAvailable()
            promise.resolve(available)
        } catch (e: Exception) {
            promise.reject("BLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        try {
            promise.resolve(bleModule.isBluetoothEnabled())
        } catch (e: Exception) {
            promise.reject("BLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hasPermissions(promise: Promise) {
        try {
            promise.resolve(bleModule.hasPermissions())
        } catch (e: Exception) {
            promise.reject("BLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startAdvertising(serviceUuidStr: String, base64Data: String, promise: Promise) {
        try {
            val advBytes = Base64.decode(base64Data, Base64.DEFAULT)
            bleModule.startAdvertising(serviceUuidStr, advBytes) { success, errorMsg ->
                if (success) {
                    promise.resolve(true)
                } else {
                    promise.reject("ADVERTISE_FAILED", errorMsg ?: "Failed to start BLE advertising")
                }
            }
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try {
            bleModule.stopAdvertising()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun startScanning(serviceUuidStr: String, promise: Promise) {
        try {
            bleModule.startScanning(serviceUuidStr) { success, errorMsg ->
                if (success) {
                    promise.resolve(true)
                } else {
                    promise.reject("SCAN_FAILED", errorMsg ?: "Failed to start BLE scanning")
                }
            }
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun stopScanning(promise: Promise) {
        try {
            bleModule.stopScanning()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun connectGatt(address: String, promise: Promise) {
        try {
            bleModule.connectGatt(address) { success, gattId, mtu, errorMsg ->
                if (success && gattId != null) {
                    val map = Arguments.createMap().apply {
                        putString("gattId", gattId)
                        putInt("mtu", mtu)
                    }
                    promise.resolve(map)
                } else {
                    promise.reject("CONNECT_FAILED", errorMsg ?: "Failed to connect to peripheral GATT")
                }
            }
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun disconnectGatt(gattId: String, promise: Promise) {
        try {
            bleModule.disconnectGatt(gattId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun writeCharacteristic(gattId: String, base64Data: String, promise: Promise) {
        try {
            val data = Base64.decode(base64Data, Base64.DEFAULT)
            bleModule.writeCharacteristic(gattId, data) { success, errorMsg ->
                if (success) {
                    promise.resolve(true)
                } else {
                    promise.reject("WRITE_FAILED", errorMsg ?: "GATT characteristic write failed")
                }
            }
        } catch (e: Exception) {
            promise.reject("BLE_EXCEPTION", e.message, e)
        }
    }
}
