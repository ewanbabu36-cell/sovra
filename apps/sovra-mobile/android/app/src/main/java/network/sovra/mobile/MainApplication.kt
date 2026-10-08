package network.sovra.mobile

import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.shell.MainReactPackage
import network.sovra.mobile.ble.SovraBleModule
import network.sovra.mobile.ble.SovraBlePackage

class MainApplication : Application(), ReactApplication {
    lateinit var bleModule: SovraBleModule
        private set

    private val mReactNativeHost: ReactNativeHost = object : ReactNativeHost(this) {
        override fun getUseDeveloperSupport(): Boolean = false

        override fun getPackages(): List<ReactPackage> = listOf(
            MainReactPackage(),
            SovraBlePackage()
        )

        override fun getJSMainModuleName(): String = "index"
    }

    override val reactNativeHost: ReactNativeHost
        get() = mReactNativeHost

    override fun onCreate() {
        super.onCreate()
        bleModule = SovraBleModule(this)
    }
}
