package network.sovra.mobile.ble

import android.content.Context
import java.util.Collections

/**
 * SovraBlePackage registers the Sovra BLE Native Module with the Android runtime.
 */
class SovraBlePackage {
    fun createNativeModule(context: Context): SovraBleModule {
        return SovraBleModule(context)
    }
}
