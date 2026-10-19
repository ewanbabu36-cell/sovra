package network.sovra.mobile.ble

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import network.sovra.mobile.MainActivity
import network.sovra.mobile.R

/**
 * SovraBleForegroundService: Native Android Foreground Service for Continuous BLE Mesh Operations.
 *
 * Ensures Bluetooth Low Energy advertising, scanning, and GATT connection maintenance
 * persist uninterrupted when the phone is locked, backgrounded, or navigating other apps.
 *
 * Compliant with Android 12, 13, and 14+ FOREGROUND_SERVICE_CONNECTED_DEVICE requirements.
 */
class SovraBleForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "sovra_ble_mesh_channel"
        const val NOTIFICATION_ID = 5076
        const val ACTION_START = "network.sovra.mobile.ble.START_FOREGROUND"
        const val ACTION_STOP = "network.sovra.mobile.ble.STOP_FOREGROUND"
        const val ACTION_UPDATE_STATUS = "network.sovra.mobile.ble.UPDATE_STATUS"
        const val EXTRA_STATUS_TEXT = "extra_status_text"

        fun start(context: Context, statusText: String = "Offline BLE Mesh Active — Scanning 2.4GHz spectrum") {
            val intent = Intent(context, SovraBleForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_STATUS_TEXT, statusText)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun updateStatus(context: Context, statusText: String) {
            val intent = Intent(context, SovraBleForegroundService::class.java).apply {
                action = ACTION_UPDATE_STATUS
                putExtra(EXTRA_STATUS_TEXT, statusText)
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, SovraBleForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(true)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE_STATUS -> {
                val status = intent.getStringExtra(EXTRA_STATUS_TEXT) ?: "Offline BLE Mesh Active"
                updateNotification(status)
                return START_STICKY
            }
            else -> {
                val status = intent?.getStringExtra(EXTRA_STATUS_TEXT) ?: "Offline BLE Mesh Active"
                val notification = buildNotification(status)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val foregroundServiceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                    } else {
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                    }
                    startForeground(NOTIFICATION_ID, notification, foregroundServiceType)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                return START_STICKY
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Sovra Offline Mesh Continuity Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps genuine device-to-device Bluetooth mesh communication active in background"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sovra Offline Mesh (BitChat Standard)")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updateNotification(statusText: String) {
        val notification = buildNotification(statusText)
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, notification)
    }
}
