package network.sovra.mobile.net

import android.app.Activity
import android.net.http.SslCertificate
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * SovraHttpBridge: Native HTTP / Self-Signed SPKI Pinned TLS / Tor SOCKS5 Bridge for WebView.
 *
 * Allows Sovra Android APK to connect to:
 * 1. Raw volunteer IPs over http://<ip>:port without WebView CORS Origin:null restrictions
 * 2. Self-signed https://<ip>:port nodes verified strictly via SPKI SHA-256 public-key pinning
 * 3. .onion hidden services routed fail-closed through local Tor SOCKS5 (127.0.0.1:9050 or custom)
 */
class SovraHttpBridge(
    private val activity: Activity,
    private val webView: WebView
) {
    private val executor = Executors.newCachedThreadPool()

    companion object {
        private val pinnedSpkiByHost = ConcurrentHashMap<String, MutableSet<String>>()

        fun normalizePinTokens(rawPin: String?): Set<String> {
            if (rawPin.isNullOrBlank()) return emptySet()
            return rawPin.split(',', ';', ' ')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .map { token ->
                    if (token.startsWith("sha256/", ignoreCase = true)) {
                        token.substring(7).trim()
                    } else {
                        token
                    }
                }
                .filter { it.isNotEmpty() }
                .toSet()
        }

        fun registerHostPin(hostOrUrl: String, spkiPin: String) {
            val pins = normalizePinTokens(spkiPin)
            if (pins.isEmpty()) return
            val host = extractHostKey(hostOrUrl) ?: return
            val set = pinnedSpkiByHost.getOrPut(host) { ConcurrentHashMap.newKeySet() }
            set.addAll(pins)
        }

        fun getPinsForHost(host: String): Set<String> {
            return pinnedSpkiByHost[host.lowercase()] ?: emptySet()
        }

        fun verifyX509MatchesPins(cert: X509Certificate, expectedPins: Set<String>): Boolean {
            if (expectedPins.isEmpty()) return false
            val spkiDigest = MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded)
            val b64 = Base64.encodeToString(spkiDigest, Base64.NO_WRAP)
            val hex = spkiDigest.joinToString("") { "%02x".format(it) }
            for (pin in expectedPins) {
                if (pin == b64 || pin.equals(hex, ignoreCase = true)) {
                    return true
                }
            }
            return false
        }

        fun verifyWebViewSslErrorIfPinned(url: String?, cert: SslCertificate?, handler: SslErrorHandler?): Boolean {
            if (url.isNullOrBlank() || cert == null || handler == null) return false
            return try {
                val host = URL(url).host.lowercase()
                val pins = getPinsForHost(host)
                if (pins.isEmpty()) return false
                val x509 = extractX509Certificate(cert) ?: return false
                if (verifyX509MatchesPins(x509, pins)) {
                    handler.proceed()
                    true
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }

        private fun extractX509Certificate(cert: SslCertificate): X509Certificate? {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    cert.x509Certificate
                } else {
                    val bundle = SslCertificate.saveState(cert)
                    val raw = bundle?.getByteArray("x509-certificate") ?: return null
                    CertificateFactory.getInstance("X.509")
                        .generateCertificate(ByteArrayInputStream(raw)) as? X509Certificate
                }
            } catch (_: Exception) {
                null
            }
        }

        private fun extractHostKey(hostOrUrl: String): String? {
            val trimmed = hostOrUrl.trim()
            if (trimmed.isEmpty()) return null
            return try {
                if (trimmed.contains("://")) {
                    URL(trimmed).host.lowercase()
                } else {
                    trimmed.split(':').firstOrNull()?.lowercase()
                }
            } catch (_: Exception) {
                null
            }
        }

        private fun parseSocksProxy(torSocks: String): InetSocketAddress? {
            val clean = torSocks.trim()
            if (clean.isEmpty()) return null
            return try {
                val withoutScheme = clean
                    .removePrefix("socks5h://")
                    .removePrefix("socks5://")
                    .removePrefix("socks://")
                    .substringBefore('/')
                val lastColon = withoutScheme.lastIndexOf(':')
                val host = if (lastColon > 0) withoutScheme.substring(0, lastColon) else withoutScheme
                val port = if (lastColon > 0) withoutScheme.substring(lastColon + 1).toIntOrNull() ?: 9050 else 9050
                val cleanHost = host.trim('[', ']')
                if (cleanHost.isEmpty()) null else InetSocketAddress(cleanHost, port)
            } catch (_: Exception) {
                null
            }
        }
    }

    @JavascriptInterface
    fun registerSpkiPin(hostOrUrl: String, spkiPin: String) {
        registerHostPin(hostOrUrl, spkiPin)
    }

    @JavascriptInterface
    fun requestAsync(
        requestId: String,
        fullUrl: String,
        method: String,
        headersJson: String,
        bodyStr: String,
        spkiPin: String,
        torSocks: String,
        timeoutMs: Int
    ) {
        executor.execute {
            val responseJson = JSONObject().apply {
                put("requestId", requestId)
            }
            var conn: HttpURLConnection? = null
            try {
                val parsedUrl = URL(fullUrl)
                val proto = parsedUrl.protocol.lowercase()
                if (proto != "http" && proto != "https") {
                    throw IllegalArgumentException("Unsupported protocol: $proto")
                }

                val isOnion = parsedUrl.host.endsWith(".onion", ignoreCase = true)
                val socksAddr = if (isOnion) {
                    parseSocksProxy(torSocks) ?: InetSocketAddress("127.0.0.1", 9050)
                } else {
                    parseSocksProxy(torSocks)
                }

                if (isOnion && socksAddr == null) {
                    throw IllegalStateException("ERR_TOR_SOCKS5_REQUIRED: .onion requests require local Tor SOCKS5 proxy")
                }

                val effectiveTimeout = timeoutMs.coerceIn(1000, 120_000)
                conn = if (socksAddr != null) {
                    parsedUrl.openConnection(Proxy(Proxy.Type.SOCKS, socksAddr)) as HttpURLConnection
                } else {
                    parsedUrl.openConnection() as HttpURLConnection
                }

                val inlinePins = normalizePinTokens(spkiPin)
                if (inlinePins.isNotEmpty()) {
                    registerHostPin(parsedUrl.host, spkiPin)
                }
                val expectedPins = if (inlinePins.isNotEmpty()) inlinePins else getPinsForHost(parsedUrl.host)

                if (conn is HttpsURLConnection && expectedPins.isNotEmpty()) {
                    val pinnedTrustManager = object : X509TrustManager {
                        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                            if (chain.isNullOrEmpty()) {
                                throw CertificateException("Empty TLS certificate chain")
                            }
                            val matched = chain.any { cert -> verifyX509MatchesPins(cert, expectedPins) }
                            if (!matched) {
                                throw CertificateException("TLS SPKI SHA-256 pin mismatch for ${parsedUrl.host}")
                            }
                        }

                        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
                    }
                    val sslCtx = SSLContext.getInstance("TLS")
                    sslCtx.init(null, arrayOf<TrustManager>(pinnedTrustManager), SecureRandom())
                    conn.sslSocketFactory = sslCtx.socketFactory
                    // Self-signed volunteer IPs/onion services authenticate via SPKI key hash rather than CA/DNS hostname
                    conn.hostnameVerifier = HostnameVerifier { _, session ->
                        val certs = session.peerCertificates
                        certs.any { cert -> cert is X509Certificate && verifyX509MatchesPins(cert, expectedPins) }
                    }
                }

                conn.connectTimeout = effectiveTimeout
                conn.readTimeout = effectiveTimeout
                conn.instanceFollowRedirects = true
                val upperMethod = method.ifBlank { "GET" }.uppercase()
                conn.requestMethod = upperMethod

                if (headersJson.isNotBlank()) {
                    val hdrs = JSONObject(headersJson)
                    val keys = hdrs.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        conn.setRequestProperty(k, hdrs.optString(k, ""))
                    }
                }

                if (bodyStr.isNotEmpty() && (upperMethod == "POST" || upperMethod == "PUT" || upperMethod == "PATCH" || upperMethod == "DELETE")) {
                    conn.doOutput = true
                    conn.outputStream.use { os ->
                        os.write(bodyStr.toByteArray(Charsets.UTF_8))
                    }
                }

                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val bodyBytes = if (stream != null) {
                    val buf = ByteArray(8192)
                    val out = ByteArrayOutputStream()
                    stream.use { s ->
                        while (true) {
                            val n = s.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                    }
                    out.toByteArray()
                } else {
                    ByteArray(0)
                }

                val respHeaders = JSONObject()
                for ((k, values) in conn.headerFields) {
                    if (k != null && !values.isNullOrEmpty()) {
                        respHeaders.put(k.lowercase(), values.joinToString(", "))
                    }
                }

                responseJson.put("status", status)
                responseJson.put("headers", respHeaders)
                responseJson.put("bodyBase64", Base64.encodeToString(bodyBytes, Base64.NO_WRAP))
                responseJson.put("body", String(bodyBytes, Charsets.UTF_8))
            } catch (e: Exception) {
                responseJson.put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Exception) {}
            }

            val serialized = responseJson.toString()
            activity.runOnUiThread {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('sovraHttpResponse', { detail: $serialized }));",
                    null
                )
            }
        }
    }
}
