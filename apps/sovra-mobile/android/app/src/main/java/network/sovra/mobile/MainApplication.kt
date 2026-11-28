package network.sovra.mobile

import android.app.Application
import network.sovra.mobile.ble.SovraBleModule
import network.sovra.mobile.p2p.SovraWifiDirectModule
import network.sovra.mobile.security.SovraHardwareKeystore

class MainApplication : Application() {
    lateinit var bleModule: SovraBleModule
        private set
    lateinit var wifiDirectModule: SovraWifiDirectModule
        private set
    lateinit var hardwareKeystore: SovraHardwareKeystore
        private set

    override fun onCreate() {
        super.onCreate()
        bleModule = SovraBleModule(this)
        wifiDirectModule = SovraWifiDirectModule(this)
        hardwareKeystore = SovraHardwareKeystore()
    }
}
