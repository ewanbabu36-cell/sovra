package network.sovra.mobile.p2p

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * SovraWifiDirectReactModule: React Native Bridge for Android Wi-Fi Direct (P2P).
 *
 * Connects TypeScript / React Native to SovraWifiDirectModule:
 * - Peer discovery and high-speed group negotiation
 * - Binary socket transport for large media payloads (photos > 500KB, videos, reels)
 * - Event forwarding for discovery, connection changes, and chunk transfer progress
 */
class SovraWifiDirectReactModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val wifiDirectModule = SovraWifiDirectModule(reactContext)

    companion object {
        const val NAME = "SovraWifiDirectNative"
    }

    override fun getName(): String = NAME

    init {
        wifiDirectModule.onDeviceDiscovered = { address, name, primaryType, status ->
            val params = Arguments.createMap().apply {
                putString("address", address)
                putString("name", name)
                putString("primaryType", primaryType)
                putInt("status", status)
            }
            sendEvent("onWifiP2pDeviceDiscovered", params)
        }

        wifiDirectModule.onConnectionChanged = { isConnected, isGroupOwner, groupOwnerAddress ->
            val params = Arguments.createMap().apply {
                putBoolean("isConnected", isConnected)
                putBoolean("isGroupOwner", isGroupOwner)
                putString("groupOwnerAddress", groupOwnerAddress ?: "")
            }
            sendEvent("onWifiP2pConnectionChanged", params)
        }

        wifiDirectModule.onIncomingMediaReceived = { transferId, senderAddress, dataBase64, sha256Hex ->
            val params = Arguments.createMap().apply {
                putString("transferId", transferId)
                putString("senderAddress", senderAddress)
                putString("dataBase64", dataBase64)
                putString("sha256Hex", sha256Hex)
            }
            sendEvent("onWifiP2pMediaReceived", params)
        }

        wifiDirectModule.onTransferProgress = { transferId, bytesTransferred, totalBytes ->
            val params = Arguments.createMap().apply {
                putString("transferId", transferId)
                putDouble("bytesTransferred", bytesTransferred.toDouble())
                putDouble("totalBytes", totalBytes.toDouble())
            }
            sendEvent("onWifiP2pTransferProgress", params)
        }

        wifiDirectModule.onError = { operation, errorCode, message ->
            val params = Arguments.createMap().apply {
                putString("operation", operation)
                putInt("errorCode", errorCode)
                putString("message", message)
            }
            sendEvent("onWifiP2pError", params)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(wifiDirectModule.isAvailable())
    }

    @ReactMethod
    fun hasPermissions(promise: Promise) {
        promise.resolve(wifiDirectModule.hasPermissions())
    }

    @ReactMethod
    fun discoverPeers(promise: Promise) {
        wifiDirectModule.discoverPeers { success, error ->
            if (success) {
                promise.resolve(true)
            } else {
                promise.reject("DISCOVERY_FAILED", error ?: "Failed to initiate peer discovery")
            }
        }
    }

    @ReactMethod
    fun stopPeerDiscovery(promise: Promise) {
        wifiDirectModule.stopPeerDiscovery { success ->
            promise.resolve(success)
        }
    }

    @ReactMethod
    fun connectPeer(deviceAddress: String, promise: Promise) {
        wifiDirectModule.connectPeer(deviceAddress) { success, error ->
            if (success) {
                promise.resolve(true)
            } else {
                promise.reject("CONNECT_FAILED", error ?: "Failed to connect to peer")
            }
        }
    }

    @ReactMethod
    fun createGroup(promise: Promise) {
        wifiDirectModule.createGroup { success, error ->
            if (success) {
                promise.resolve(true)
            } else {
                promise.reject("CREATE_GROUP_FAILED", error ?: "Failed to create group")
            }
        }
    }

    @ReactMethod
    fun removeGroup(promise: Promise) {
        wifiDirectModule.removeGroup { success ->
            promise.resolve(success)
        }
    }

    @ReactMethod
    fun sendMediaPayload(
        targetHost: String,
        port: Int,
        transferId: String,
        base64Payload: String,
        promise: Promise
    ) {
        wifiDirectModule.sendMediaPayload(targetHost, port, transferId, base64Payload) { success, resultOrError ->
            if (success) {
                val map = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("sha256Hex", resultOrError)
                }
                promise.resolve(map)
            } else {
                promise.reject("TRANSFER_FAILED", resultOrError ?: "Failed to send media payload")
            }
        }
    }

    @ReactMethod
    fun startMediaServer(port: Int, promise: Promise) {
        wifiDirectModule.startMediaServer(port)
        promise.resolve(true)
    }

    @ReactMethod
    fun stopMediaServer(promise: Promise) {
        wifiDirectModule.stopMediaServer()
        promise.resolve(true)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        wifiDirectModule.cleanup()
    }
}
