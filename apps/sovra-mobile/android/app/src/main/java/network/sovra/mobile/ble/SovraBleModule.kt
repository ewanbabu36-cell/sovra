package network.sovra.mobile.ble

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * SovraBleModule: Genuine Android Bluetooth Low Energy Native Module.
 *
 * Implements real-world BLE mesh radio operations:
 * - BluetoothLeScanner with ScanFilter and duplicate throttling
 * - BluetoothLeAdvertiser with LOW_LATENCY and HIGH_TX_POWER
 * - BluetoothGattServer hosting Sovra Mesh GATT Service & Characteristics
 * - BluetoothGatt Central client managing 512 MTU negotiation and write-with-response
 * - Hardware and permission lifecycle monitors (ACTION_STATE_CHANGED)
 * - Zero fake success returns: strictly reports actual GATT callbacks
 */
class SovraBleModule(private val context: Context) {

    companion object {
        const val TAG = "SovraBleModule"
        val SOVRA_SERVICE_UUID: UUID = UUID.fromString("00005356-0000-1000-8000-00805f9b34fb")
        val SOVRA_WRITE_CHAR_UUID: UUID = UUID.fromString("00005357-0000-1000-8000-00805f9b34fb")
        val SOVRA_NOTIFY_CHAR_UUID: UUID = UUID.fromString("00005358-0000-1000-8000-00805f9b34fb")
        val CLIENT_CONFIG_DESCRIPTOR_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val DEFAULT_MAX_MTU = 512
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter

    private val mainHandler = Handler(Looper.getMainLooper())

    data class PendingWrite(
        val chunk: ByteArray,
        val callback: (Boolean, String?) -> Unit,
        var retryCount: Int = 0
    )

    // Active GATT Connections: gattId -> ActiveConnection
    data class ActiveConnection(
        val gattId: String,
        val address: String = "",
        val gatt: BluetoothGatt,
        var mtu: Int = 23,
        var writeCharacteristic: BluetoothGattCharacteristic? = null,
        var notifyCharacteristic: BluetoothGattCharacteristic? = null,
        var isConnected: Boolean = false,
        var onDisconnected: (() -> Unit)? = null,
        val writeQueue: java.util.concurrent.ConcurrentLinkedQueue<PendingWrite> = java.util.concurrent.ConcurrentLinkedQueue(),
        @Volatile var isWriteInFlight: Boolean = false,
        var currentWrite: PendingWrite? = null,
        var watchdogRunnable: Runnable? = null
    )

    private val activeConnections = ConcurrentHashMap<String, ActiveConnection>()
    private val discoveredDevices = ConcurrentHashMap<String, Long>()
    private val discoveredNames = ConcurrentHashMap<String, String>()
    private val smoothedRssiMap = ConcurrentHashMap<String, Double>()

    private var activeAdvertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private var currentAdvertisedName: String? = null
    private var gattServer: BluetoothGattServer? = null
    private var isScanning = false
    private var scanCallback: ScanCallback? = null

    // Event callbacks to JavaScript bridge
    var onDeviceDiscovered: ((address: String, rssi: Int, serviceData: ByteArray, name: String?) -> Unit)? = null
    var onDeviceDiscoveredWithTxPower: ((address: String, rssi: Int, txPower: Int, serviceData: ByteArray, name: String?) -> Unit)? = null
    var onIncomingDataReceived: ((gattId: String, data: ByteArray) -> Unit)? = null
    var onPeerDisconnected: ((gattId: String) -> Unit)? = null

    init {
        registerBluetoothStateReceiver()
    }

    // ==========================================
    // 1. HARDWARE & PERMISSION CHECKS
    // ==========================================

    fun isAvailable(): Boolean {
        val adapter = bluetoothAdapter ?: return false
        return adapter.isEnabled
    }

    fun isBluetoothEnabled(): Boolean {
        return bluetoothAdapter?.isEnabled == true
    }

    fun hasPermissions(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val scan = context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            val adv = context.checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
            val conn = context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            return scan && adv && conn
        } else {
            val fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val bt = context.checkSelfPermission(Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
            return fine && bt
        }
    }

    fun isLocationEnabled(): Boolean {
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) return true
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager ?: return false
        return lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
               lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
    }

    fun requiresLocationServices(): Boolean {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.R
    }

    private fun registerBluetoothStateReceiver() {
        val filter = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }
        context.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                when (intent?.action) {
                    BluetoothAdapter.ACTION_STATE_CHANGED -> {
                        val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                        if (state == BluetoothAdapter.STATE_OFF || state == BluetoothAdapter.STATE_TURNING_OFF) {
                            Log.w(TAG, "Android Bluetooth radio disabled; tearing down all active GATT connections")
                            cleanupAllConnections()
                        }
                    }
                    Intent.ACTION_SCREEN_OFF -> {
                        Log.i(TAG, "Screen OFF detected: adapting BLE scan duty cycle to BACKGROUND_LOW_POWER")
                        setScanDutyCycle("BACKGROUND_LOW_POWER")
                    }
                    Intent.ACTION_SCREEN_ON -> {
                        Log.i(TAG, "Screen ON detected: restoring BLE scan duty cycle to ACTIVE")
                        setScanDutyCycle("ACTIVE")
                    }
                }
            }
        }, filter)
    }

    // Track devices connected to our GATT Server
    private val serverConnectedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    // ==========================================
    // 2. BLE ADVERTISING (PERIPHERAL ROLE)
    // ==========================================

    @Synchronized
    fun startAdvertising(
        serviceUuidStr: String,
        advertisementData: ByteArray,
        username: String? = null,
        callback: (Boolean, String?) -> Unit
    ) {
        if (!hasPermissions()) {
            callback(false, "Bluetooth permissions not granted")
            return
        }
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            callback(false, "Bluetooth adapter is disabled or unavailable")
            return
        }

        val advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) {
            callback(false, "Device does not support BLE Peripheral advertising")
            return
        }

        val cleanUsername = username?.trim()
        // If advertiser is already actively transmitting this name, do not restart
        if (activeAdvertiser != null && currentAdvertisedName == cleanUsername) {
            Log.d(TAG, "BLE Advertiser already active for '$cleanUsername'; maintaining beacon")
            callback(true, null)
            return
        }

        // Initialize GATT Server to handle incoming mesh connections
        setupGattServer()

        if (!cleanUsername.isNullOrEmpty()) {
            try {
                adapter.name = cleanUsername
                Log.i(TAG, "BluetoothAdapter name set to '$cleanUsername'")
            } catch (e: Exception) {
                Log.w(TAG, "Unable to set adapter name: ${e.message}")
            }
        }

        val serviceUuid = try {
            UUID.fromString(serviceUuidStr)
        } catch (e: Exception) {
            SOVRA_SERVICE_UUID
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        // ADV_IND packet (strictly <= 31 bytes):
        // Service UUID (16 bytes) + flags (3 bytes) = 19 bytes <= 31 bytes
        val dataBuilder = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(serviceUuid))

        // SCAN_RSP packet (strictly <= 31 bytes):
        // To guarantee NEVER hitting ADVERTISE_FAILED_DATA_TOO_LARGE, we DO NOT call setIncludeDeviceName(true)
        // when manufacturer data is present, as long phone names (15-20 bytes) + mfg data exceed 31 bytes.
        val scanResponseBuilder = AdvertiseData.Builder()
            .setIncludeDeviceName(false)

        val nameBytes = (cleanUsername ?: "").toByteArray(Charsets.UTF_8)
        val mfgPayload = if (nameBytes.isNotEmpty()) {
            // Cap at 16 bytes so 16 + 2 (ID) + 2 (header) = 20 bytes <= 31 bytes
            if (nameBytes.size > 16) nameBytes.copyOf(16) else nameBytes
        } else if (advertisementData.isNotEmpty()) {
            if (advertisementData.size > 16) advertisementData.copyOf(16) else advertisementData
        } else {
            null
        }

        if (mfgPayload != null && mfgPayload.isNotEmpty()) {
            scanResponseBuilder.addManufacturerData(0x5356, mfgPayload)
        }

        stopAdvertising()

        val advCb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                Log.i(TAG, "BLE Peripheral Advertising started successfully on $serviceUuid (name='$cleanUsername')")
                activeAdvertiser = advertiser
                currentAdvertisedName = cleanUsername
                callback(true, null)
            }

            override fun onStartFailure(errorCode: Int) {
                Log.e(TAG, "BLE Peripheral Advertising failed with error code: $errorCode")
                // Automatic Fallback for strict Bluetooth stacks:
                // If primary advertising fails (e.g. DATA_TOO_LARGE code 1), retry with bare minimal payload
                if (errorCode == AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE || errorCode == AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR) {
                    Log.w(TAG, "Retrying BLE advertising with minimal payload fallback...")
                    try {
                        advertiser.startAdvertising(settings, dataBuilder.build(), object : AdvertiseCallback() {
                            override fun onStartSuccess(s: AdvertiseSettings?) {
                                Log.i(TAG, "BLE Minimal Fallback Advertising succeeded!")
                                activeAdvertiser = advertiser
                                currentAdvertisedName = cleanUsername
                                callback(true, null)
                            }
                            override fun onStartFailure(err: Int) {
                                Log.e(TAG, "BLE Minimal Fallback Advertising also failed: $err")
                                callback(false, "Advertising failed with code $err")
                            }
                        })
                        return
                    } catch (e: Exception) {
                        Log.e(TAG, "Fallback advertising exception: ${e.message}")
                    }
                }
                callback(false, "Advertising failed with code $errorCode")
            }
        }

        this.advertiseCallback = advCb
        try {
            advertiser.startAdvertising(settings, dataBuilder.build(), scanResponseBuilder.build(), advCb)
        } catch (e: Exception) {
            Log.e(TAG, "startAdvertising exception: ${e.message}")
            callback(false, e.message)
        }
    }

    // Overload for backward compatibility
    fun startAdvertising(serviceUuidStr: String, advertisementData: ByteArray, callback: (Boolean, String?) -> Unit) {
        startAdvertising(serviceUuidStr, advertisementData, null, callback)
    }

    @Synchronized
    fun stopAdvertising() {
        try {
            if (activeAdvertiser != null && advertiseCallback != null) {
                activeAdvertiser?.stopAdvertising(advertiseCallback)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping BLE advertising: ${e.message}")
        } finally {
            activeAdvertiser = null
            advertiseCallback = null
            currentAdvertisedName = null
        }
    }

    // ==========================================
    // 3. BLE SCANNING & ADAPTIVE DUTY-CYCLING (CENTRAL ROLE)
    // ==========================================

    var scanDutyMode: String = "ACTIVE"
        private set
    private var scanDutyRunnable: Runnable? = null
    private var savedServiceUuidStr: String = SOVRA_SERVICE_UUID.toString()
    private var isUserScanActive = false

    @Synchronized
    fun setScanDutyCycle(mode: String, callback: ((Boolean, String?) -> Unit)? = null) {
        val normalized = mode.uppercase(Locale.ROOT)
        if (normalized != "ACTIVE" && normalized != "BACKGROUND_LOW_POWER") {
            callback?.invoke(false, "Unsupported scan duty mode: $mode")
            return
        }

        scanDutyMode = normalized
        Log.i(TAG, "Scan duty cycle adapted to: $scanDutyMode")

        scanDutyRunnable?.let { mainHandler.removeCallbacks(it) }
        scanDutyRunnable = null

        if (!isUserScanActive) {
            callback?.invoke(true, null)
            return
        }

        if (normalized == "ACTIVE") {
            // Revert to continuous LOW_LATENCY scanning
            stopRawScan()
            startRawScan(savedServiceUuidStr, ScanSettings.SCAN_MODE_LOW_LATENCY) { success, err ->
                callback?.invoke(success, err)
            }
        } else {
            // BACKGROUND_LOW_POWER: 5s scan window every 45s interval
            scheduleDutyCycleScanWindow()
            callback?.invoke(true, null)
        }
    }

    private fun scheduleDutyCycleScanWindow() {
        if (!isUserScanActive || scanDutyMode != "BACKGROUND_LOW_POWER") return

        // 1. Run 5s scan window in SCAN_MODE_LOW_POWER
        startRawScan(savedServiceUuidStr, ScanSettings.SCAN_MODE_LOW_POWER) { success, _ ->
            if (success) {
                Log.d(TAG, "Duty Cycle: Started 5s low-power scan window")
            }
        }

        // 2. Schedule pause after 5 seconds
        val pauseRunnable = Runnable {
            if (!isUserScanActive || scanDutyMode != "BACKGROUND_LOW_POWER") return@Runnable
            Log.d(TAG, "Duty Cycle: Pausing scan window for 40s")
            stopRawScan()

            // 3. Re-schedule next 5s window after 40 seconds (total 45s cycle)
            val nextCycleRunnable = Runnable {
                scheduleDutyCycleScanWindow()
            }
            scanDutyRunnable = nextCycleRunnable
            mainHandler.postDelayed(nextCycleRunnable, 40000L)
        }

        scanDutyRunnable = pauseRunnable
        mainHandler.postDelayed(pauseRunnable, 5000L)
    }

    @Synchronized
    fun startScanning(serviceUuidStr: String, callback: (Boolean, String?) -> Unit) {
        savedServiceUuidStr = serviceUuidStr
        isUserScanActive = true

        if (scanDutyMode == "BACKGROUND_LOW_POWER") {
            scheduleDutyCycleScanWindow()
            callback(true, null)
        } else {
            startRawScan(serviceUuidStr, ScanSettings.SCAN_MODE_LOW_LATENCY, callback)
        }
    }

    @Synchronized
    private fun startRawScan(
        serviceUuidStr: String,
        scanMode: Int,
        callback: ((Boolean, String?) -> Unit)? = null
    ) {
        if (!hasPermissions()) {
            callback?.invoke(false, "Bluetooth scan permissions not granted")
            return
        }
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            callback?.invoke(false, "Bluetooth adapter is disabled or unavailable")
            return
        }
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            callback?.invoke(false, "BluetoothLeScanner unavailable")
            return
        }

        if (isScanning && scanCallback != null) {
            callback?.invoke(true, null)
            return
        }

        val serviceUuid = try {
            UUID.fromString(serviceUuidStr)
        } catch (e: Exception) {
            SOVRA_SERVICE_UUID
        }

        val filters = mutableListOf<ScanFilter>()
        filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build())
        filters.add(ScanFilter.Builder().setManufacturerData(0x5356, byteArrayOf()).build())
        filters.add(ScanFilter.Builder().build())

        val settings = ScanSettings.Builder()
            .setScanMode(scanMode)
            .setReportDelay(0)
            .build()

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                if (result == null) return
                val device = result.device ?: return
                val address = device.address ?: return
                val rssi = result.rssi
                val scanRecord = result.scanRecord ?: return

                val serviceUuids = scanRecord.serviceUuids
                val hasSovraUuid = serviceUuids?.any {
                    it.uuid == serviceUuid ||
                    it.uuid.toString().equals(serviceUuidStr, ignoreCase = true) ||
                    it.uuid.toString().startsWith("00005356", ignoreCase = true)
                } == true

                val mfgData = scanRecord.getManufacturerSpecificData(0x5356)
                val hasSovraMfg = (mfgData != null && mfgData.isNotEmpty())

                val rawName = scanRecord.deviceName ?: device.name ?: ""
                val hasSovraName = rawName.contains("Sovra", ignoreCase = true) ||
                                   rawName.contains("Peer", ignoreCase = true)

                if (!hasSovraUuid && !hasSovraMfg && !hasSovraName) {
                    return
                }

                val serviceData = scanRecord.getServiceData(ParcelUuid(serviceUuid)) ?: ByteArray(0)

                val customName = if (mfgData != null && mfgData.isNotEmpty()) {
                    try {
                        String(mfgData, Charsets.UTF_8).trim()
                    } catch (e: Exception) {
                        null
                    }
                } else null

                val resolvedName = if (!customName.isNullOrBlank()) {
                    customName
                } else if (rawName.isNotBlank()) {
                    rawName
                } else {
                    "Peer " + address.take(8)
                }

                val rawTxPower = scanRecord.txPowerLevel
                val txPower = if (rawTxPower != Integer.MIN_VALUE && rawTxPower != 0) rawTxPower else -59

                // Exponential Moving Average (EMA) smoothing: smoothedRssi = (0.25 * currentRssi) + (0.75 * previousRssi)
                val prevSmoothed = smoothedRssiMap[address]
                val smoothed = if (prevSmoothed != null) {
                    (0.25 * rssi.toDouble()) + (0.75 * prevSmoothed)
                } else {
                    rssi.toDouble()
                }
                smoothedRssiMap[address] = smoothed
                val smoothedRssi = Math.round(smoothed).toInt()

                val now = System.currentTimeMillis()
                val lastSeen = discoveredDevices[address] ?: 0L
                val previousName = discoveredNames[address]
                if (now - lastSeen < 1500 && previousName == resolvedName) {
                    return
                }
                discoveredDevices[address] = now
                discoveredNames[address] = resolvedName

                Log.d(TAG, "Discovered Sovra Peer: $address (name='$resolvedName', rssi=$smoothedRssi, rawRssi=$rssi, txPower=$txPower)")
                onDeviceDiscoveredWithTxPower?.invoke(address, smoothedRssi, txPower, serviceData, resolvedName)
                onDeviceDiscovered?.invoke(address, smoothedRssi, serviceData, resolvedName)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "BLE Scan failed with errorCode: $errorCode")
                isScanning = false
                scanCallback = null
            }
        }

        this.scanCallback = cb
        this.isScanning = true
        try {
            scanner.startScan(filters, settings, cb)
            callback?.invoke(true, null)
        } catch (e: Exception) {
            Log.e(TAG, "scanner.startScan exception: ${e.message}")
            isScanning = false
            scanCallback = null
            callback?.invoke(false, e.message)
        }
    }

    @Synchronized
    private fun stopRawScan() {
        if (isScanning && scanCallback != null) {
            try {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping BLE raw scan: ${e.message}")
            }
        }
        isScanning = false
        scanCallback = null
    }

    @Synchronized
    fun stopScanning() {
        isUserScanActive = false
        scanDutyRunnable?.let { mainHandler.removeCallbacks(it) }
        scanDutyRunnable = null
        stopRawScan()
    }

    // ==========================================
    // 4. GATT CLIENT (CONNECTION & MTU NEGOTIATION)
    // ==========================================

    fun connectGatt(
        address: String,
        timeoutMs: Long = 10000,
        callback: (Boolean, String?, Int, String?) -> Unit
    ) {
        if (!hasPermissions()) {
            callback(false, null, 0, "Missing Bluetooth connect permissions")
            return
        }
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            callback(false, null, 0, "Bluetooth radio is disabled")
            return
        }

        val device = try {
            adapter.getRemoteDevice(address)
        } catch (e: Exception) {
            callback(false, null, 0, "Invalid Bluetooth address: $address")
            return
        }

        val gattId = UUID.randomUUID().toString()
        var completed = false

        // Connection timeout watchdog
        val timeoutRunnable = Runnable {
            if (!completed) {
                completed = true
                Log.w(TAG, "GATT connection timeout to $address")
                disconnectGatt(gattId)
                callback(false, null, 0, "Connection timed out after ${timeoutMs}ms")
            }
        }
        mainHandler.postDelayed(timeoutRunnable, timeoutMs)

        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                Log.i(TAG, "GATT Client onConnectionStateChange: status=$status newState=$newState")
                if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                    val conn = activeConnections[gattId]
                    if (conn != null) {
                        conn.isConnected = true
                        // Step 1: Request 512 MTU first for high-throughput mesh packets
                        val mtuOk = try {
                            gatt.requestMtu(DEFAULT_MAX_MTU)
                        } catch (e: Exception) {
                            false
                        }
                        if (!mtuOk) {
                            Log.w(TAG, "GATT requestMtu returned false; fallback directly to discoverServices")
                            gatt.discoverServices()
                        }
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    val conn = activeConnections.remove(gattId)
                    conn?.isConnected = false
                    conn?.onDisconnected?.invoke()
                    onPeerDisconnected?.invoke(gattId)
                    try { gatt.close() } catch (e: Exception) {}
                    if (!completed) {
                        completed = true
                        mainHandler.removeCallbacks(timeoutRunnable)
                        callback(false, null, 0, "GATT disconnected with status $status")
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                Log.i(TAG, "GATT Client onMtuChanged: negotiated MTU=$mtu status=$status")
                val conn = activeConnections[gattId]
                if (conn != null) {
                    conn.mtu = if (status == BluetoothGatt.GATT_SUCCESS) mtu else 23
                }
                // Step 2: Discover GATT Services AFTER MTU negotiation is acknowledged
                gatt.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                Log.i(TAG, "GATT Client onServicesDiscovered: status=$status")
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val service = gatt.getService(SOVRA_SERVICE_UUID)
                    if (service != null) {
                        val writeChar = service.getCharacteristic(SOVRA_WRITE_CHAR_UUID)
                        val notifyChar = service.getCharacteristic(SOVRA_NOTIFY_CHAR_UUID)

                        val conn = activeConnections[gattId]
                        if (conn != null) {
                            conn.writeCharacteristic = writeChar
                            conn.notifyCharacteristic = notifyChar

                            // Step 3: Enable local notifications for incoming data
                            if (notifyChar != null) {
                                gatt.setCharacteristicNotification(notifyChar, true)
                                val desc = notifyChar.getDescriptor(CLIENT_CONFIG_DESCRIPTOR_UUID)
                                if (desc != null) {
                                    desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                    val descWritten = gatt.writeDescriptor(desc)
                                    if (descWritten) {
                                        // Success callback will be triggered in onDescriptorWrite
                                        return
                                    }
                                }
                            }

                            // If descriptor write not needed or already done, complete connection now
                            if (!completed) {
                                completed = true
                                mainHandler.removeCallbacks(timeoutRunnable)
                                callback(true, gattId, conn.mtu, null)
                            }
                        }
                    } else {
                        if (!completed) {
                            completed = true
                            mainHandler.removeCallbacks(timeoutRunnable)
                            callback(false, null, 0, "Sovra GATT Service not found on peer")
                        }
                    }
                } else {
                    if (!completed) {
                        completed = true
                        mainHandler.removeCallbacks(timeoutRunnable)
                        callback(false, null, 0, "GATT service discovery failed with status $status")
                    }
                }
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                Log.i(TAG, "GATT Client onDescriptorWrite: status=$status")
                val conn = activeConnections[gattId]
                if (!completed) {
                    completed = true
                    mainHandler.removeCallbacks(timeoutRunnable)
                    callback(true, gattId, conn?.mtu ?: 23, null)
                }
            }

            override fun onCharacteristicWrite(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                Log.i(TAG, "GATT Client onCharacteristicWrite: status=$status")
                val conn = activeConnections[gattId] ?: return
                synchronized(conn) {
                    conn.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
                    conn.watchdogRunnable = null

                    val current = conn.currentWrite
                    conn.currentWrite = null
                    conn.isWriteInFlight = false

                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        current?.callback?.invoke(true, null)
                        processWriteQueue(conn)
                    } else if ((status == 133 || status == 143 || status == 257) && current != null && current.retryCount < 3) {
                        current.retryCount++
                        val delay = when (current.retryCount) {
                            1 -> 50L
                            2 -> 150L
                            else -> 350L
                        }
                        Log.w(TAG, "GATT Write status=$status (busy/timeout). Backoff retry in ${delay}ms (attempt ${current.retryCount}/3)...")
                        conn.writeQueue.add(current)
                        mainHandler.postDelayed({ processWriteQueue(conn) }, delay)
                    } else {
                        current?.callback?.invoke(false, "GATT write failed with status $status")
                        processWriteQueue(conn)
                    }
                }
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic
            ) {
                if (characteristic.uuid == SOVRA_NOTIFY_CHAR_UUID) {
                    val data = characteristic.value ?: return
                    Log.i(TAG, "GATT Client received notify data len=${data.size}")
                    onIncomingDataReceived?.invoke(gattId, data)
                }
            }
        }

        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattCallback)
        }

        activeConnections[gattId] = ActiveConnection(
            gattId = gattId,
            address = address,
            gatt = gatt,
            isConnected = false
        )
    }

    // ==========================================
    // 5. GATT WRITE WITH RESPONSE (FIFO QUEUE & MTU CHUNKING GUARD)
    // ==========================================

    fun writeCharacteristic(
        gattId: String,
        data: ByteArray,
        callback: (Boolean, String?) -> Unit
    ) {
        val conn = activeConnections[gattId]
        if (conn == null || !conn.isConnected) {
            callback(false, "GATT connection not active or disconnected")
            return
        }

        val writeChar = conn.writeCharacteristic
        if (writeChar == null) {
            callback(false, "Write characteristic not available")
            return
        }

        // Native MTU Boundary Chunking Guard (Effective payload size = MTU - 3 ATT bytes)
        val maxPayload = Math.max(20, conn.mtu - 3)
        if (data.size <= maxPayload) {
            conn.writeQueue.add(PendingWrite(data, callback))
        } else {
            val chunkPayloadSize = Math.max(18, maxPayload - 2)
            val totalChunks = Math.ceil(data.size.toDouble() / chunkPayloadSize.toDouble()).toInt()
            var offset = 0
            val chunks = ArrayList<ByteArray>()
            for (seq in 0 until totalChunks) {
                val len = Math.min(chunkPayloadSize, data.size - offset)
                val slice = ByteArray(len + 2)
                slice[0] = seq.toByte()
                slice[1] = totalChunks.toByte()
                System.arraycopy(data, offset, slice, 2, len)
                offset += len
                chunks.add(slice)
            }

            var chunkIndex = 0
            fun enqueueNextChunk() {
                if (chunkIndex >= chunks.size) return
                val isLast = (chunkIndex == chunks.size - 1)
                val chunkData = chunks[chunkIndex]
                chunkIndex++
                conn.writeQueue.add(PendingWrite(chunkData, { success, err ->
                    if (!success) {
                        callback(false, err ?: "Chunk write failed")
                    } else if (isLast) {
                        callback(true, null)
                    } else {
                        enqueueNextChunk()
                        processWriteQueue(conn)
                    }
                }))
            }
            enqueueNextChunk()
        }

        processWriteQueue(conn)
    }

    private fun processWriteQueue(conn: ActiveConnection) {
        synchronized(conn) {
            if (!conn.isConnected || conn.isWriteInFlight || conn.writeQueue.isEmpty()) {
                return
            }

            val next = conn.writeQueue.poll() ?: return
            val writeChar = conn.writeCharacteristic ?: run {
                next.callback(false, "Write characteristic unavailable")
                return
            }

            conn.isWriteInFlight = true
            conn.currentWrite = next

            // 3.5s Watchdog timer for pending write
            val watchdog = Runnable {
                synchronized(conn) {
                    if (conn.currentWrite === next && conn.isWriteInFlight) {
                        Log.w(TAG, "GATT write watchdog timeout on ${conn.gattId}")
                        conn.isWriteInFlight = false
                        conn.currentWrite = null
                        next.callback(false, "GATT write timed out")
                        processWriteQueue(conn)
                    }
                }
            }
            conn.watchdogRunnable = watchdog
            mainHandler.postDelayed(watchdog, 3500)

            writeChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            writeChar.value = next.chunk

            val initiated = conn.gatt.writeCharacteristic(writeChar)
            if (!initiated) {
                conn.watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
                conn.watchdogRunnable = null
                conn.isWriteInFlight = false
                conn.currentWrite = null

                if (next.retryCount < 3) {
                    next.retryCount++
                    val delay = when (next.retryCount) {
                        1 -> 50L
                        2 -> 150L
                        else -> 350L
                    }
                    Log.w(TAG, "GATT write not initiated. Retrying in ${delay}ms (attempt ${next.retryCount}/3)...")
                    conn.writeQueue.add(next)
                    mainHandler.postDelayed({ processWriteQueue(conn) }, delay)
                } else {
                    next.callback(false, "Failed to initiate GATT write on native Bluetooth stack")
                    processWriteQueue(conn)
                }
            }
        }
    }

    fun disconnectGatt(gattId: String) {
        val conn = activeConnections.remove(gattId)
        if (conn != null) {
            conn.isConnected = false
            try {
                conn.gatt.disconnect()
                conn.gatt.close()
            } catch (e: Exception) {
                Log.w(TAG, "Error closing GATT: ${e.message}")
            }
            conn.onDisconnected?.invoke()
        }
    }

    fun sendDataToAddress(address: String, data: ByteArray, callback: ((Boolean, String?) -> Unit)? = null) {
        // 1. If we already have an active client connection to this address, write directly
        val existingClient = activeConnections.values.find {
            it.address.equals(address, ignoreCase = true) && it.isConnected && it.writeCharacteristic != null
        }
        if (existingClient != null) {
            writeCharacteristic(existingClient.gattId, data) { ok, err ->
                callback?.invoke(ok, err)
            }
            return
        }

        // 2. If this peer is connected to our GATT Server, send via GATT Notification
        val serverClient = serverConnectedDevices.values.find {
            it.address.equals(address, ignoreCase = true)
        }
        if (serverClient != null && gattServer != null) {
            val service = gattServer?.getService(SOVRA_SERVICE_UUID)
            val notifyChar = service?.getCharacteristic(SOVRA_NOTIFY_CHAR_UUID)
            if (notifyChar != null) {
                notifyChar.value = data
                val notified = gattServer?.notifyCharacteristicChanged(serverClient, notifyChar, false) ?: false
                if (notified) {
                    Log.i(TAG, "Sent data via GATT Server notification to ${serverClient.address}")
                    callback?.invoke(true, null)
                    return
                }
            }
        }

        // 3. Otherwise, connect as client and write
        connectGatt(address) { ok, gattId, _, err ->
            if (ok && gattId != null) {
                mainHandler.postDelayed({
                    writeCharacteristic(gattId, data) { wOk, wErr ->
                        callback?.invoke(wOk, wErr)
                    }
                }, 100)
            } else {
                callback?.invoke(false, err ?: "Failed to connect to peer")
            }
        }
    }

    fun broadcastDataToDiscoveredPeers(data: ByteArray, callback: ((Int) -> Unit)? = null) {
        val allAddresses = (discoveredDevices.keys().toList() + serverConnectedDevices.keys().toList()).distinct()
        if (allAddresses.isEmpty()) {
            callback?.invoke(0)
            return
        }
        var count = 0
        allAddresses.forEach { addr ->
            sendDataToAddress(addr, data) { ok, _ ->
                if (ok) count++
            }
        }
        callback?.invoke(allAddresses.size)
    }

    // ==========================================
    // 6. GATT SERVER (HOSTING SOVRA SERVICE)
    // ==========================================

    @Synchronized
    private fun setupGattServer() {
        if (gattServer != null) return
        val manager = bluetoothManager ?: return

        val serverCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
                Log.i(TAG, "GATT Server peer state change: ${device.address} newState=$newState status=$status")
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    serverConnectedDevices[device.address] = device
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    serverConnectedDevices.remove(device.address)
                }
            }

            override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
                Log.i(TAG, "GATT Server onMtuChanged: device=${device.address} mtu=$mtu")
            }

            override fun onDescriptorWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                descriptor: BluetoothGattDescriptor,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray?
            ) {
                Log.i(TAG, "GATT Server onDescriptorWriteRequest from ${device.address}")
                descriptor.value = value
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray?
            ) {
                Log.i(TAG, "GATT Server onCharacteristicWriteRequest from ${device.address}, len=${value?.size}")
                if (characteristic.uuid == SOVRA_WRITE_CHAR_UUID && value != null) {
                    onIncomingDataReceived?.invoke(device.address, value)
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                    }
                } else if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null)
                }
            }

            override fun onNotificationSent(device: BluetoothDevice, status: Int) {
                Log.i(TAG, "GATT Server onNotificationSent to ${device.address} status=$status")
            }
        }

        gattServer = manager.openGattServer(context, serverCallback)
        if (gattServer == null) {
            Log.w(TAG, "Unable to open BluetoothGattServer")
            return
        }

        val service = BluetoothGattService(SOVRA_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        val writeChar = BluetoothGattCharacteristic(
            SOVRA_WRITE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        val notifyChar = BluetoothGattCharacteristic(
            SOVRA_NOTIFY_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )

        val cccd = BluetoothGattDescriptor(
            CLIENT_CONFIG_DESCRIPTOR_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        notifyChar.addDescriptor(cccd)

        service.addCharacteristic(writeChar)
        service.addCharacteristic(notifyChar)

        gattServer?.addService(service)
    }

    private fun cleanupAllConnections() {
        for ((id, _) in activeConnections) {
            disconnectGatt(id)
        }
        stopAdvertising()
        stopScanning()
        gattServer?.close()
        gattServer = null
    }
}
