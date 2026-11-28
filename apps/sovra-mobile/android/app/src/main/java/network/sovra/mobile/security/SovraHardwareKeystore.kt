package network.sovra.mobile.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * SovraHardwareKeystore: Hardware-Backed Android Keystore / StrongBox Vault Key Wrapper.
 * Ensures identity vault wrapping keys remain inside Android TEE/StrongBox rather than WebView localStorage.
 */
class SovraHardwareKeystore {
    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "sovra_identity_vault_master_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
    }

    private fun getOrCreateMasterKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            return existing.secretKey
        }
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    fun isStrongBoxOrTee(): Boolean {
        return try {
            val key = getOrCreateMasterKey()
            val factory = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
            val keyInfo = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
                    keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
            } else {
                @Suppress("DEPRECATION")
                keyInfo.isInsideSecureHardware
            }
        } catch (_: Exception) {
            false
        }
    }

    fun isHardwareBacked(): Boolean {
        return isStrongBoxOrTee()
    }

    fun wrapSecret(secretBase64: String): String {
        val plaintext = Base64.decode(secretBase64, Base64.DEFAULT)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val teeBacked = isStrongBoxOrTee()
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
        val ct = cipher.doFinal(plaintext)
        val iv = cipher.iv
        return JSONObject().apply {
            put("hwBacked", teeBacked)
            put("ivB64", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("ctB64", Base64.encodeToString(ct, Base64.NO_WRAP))
        }.toString()
    }

    fun unwrapSecret(wrappedJson: String): String {
        val obj = JSONObject(wrappedJson)
        val iv = Base64.decode(obj.getString("ivB64"), Base64.DEFAULT)
        val ct = Base64.decode(obj.getString("ctB64"), Base64.DEFAULT)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateMasterKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        val plaintext = cipher.doFinal(ct)
        return Base64.encodeToString(plaintext, Base64.NO_WRAP)
    }
}
