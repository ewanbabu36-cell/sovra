package network.sovra.mobile

import android.app.Application
import network.sovra.mobile.ble.SovraBleModule

class MainApplication : Application() {
    lateinit var bleModule: SovraBleModule
        private set

    override fun onCreate() {
        super.onCreate()
        bleModule = SovraBleModule(this)
    }
}
