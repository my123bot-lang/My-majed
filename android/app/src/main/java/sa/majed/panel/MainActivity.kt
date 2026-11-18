package sa.majed.panel

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.appbar.MaterialToolbar
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var progress: View
    private lateinit var errorPanel: View

    private var mainFrameFailed = false
    private var pendingDownload: DownloadRequest? = null
    private val io = Executors.newSingleThreadExecutor()

    private val writePermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val request = pendingDownload
        pendingDownload = null
        if (granted && request != null) {
            io.execute { downloadOnBackground(request) }
        } else if (!granted) {
            toast(getString(R.string.storage_permission))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.inflateMenu(R.menu.main_menu)
        toolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_refresh -> {
                    hideError()
                    webView.reload()
                    true
                }
                R.id.action_server -> {
                    showServerDialog()
                    true
                }
                R.id.action_clear -> {
                    confirmClearSession()
                    true
                }
                else -> false
            }
        }

        progress = findViewById(R.id.progress)
        errorPanel = findViewById(R.id.errorPanel)
        swipe = findViewById(R.id.swipe)
        webView = findViewById(R.id.web)

        swipe.setColorSchemeColors(getColor(R.color.teal))
        swipe.setOnRefreshListener { webView.reload() }
        findViewById<View>(R.id.retryButton).setOnClickListener {
            hideError()
            loadBase()
        }
        findViewById<View>(R.id.errorSettingsButton).setOnClickListener { showServerDialog() }

        setupWebView()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (errorPanel.visibility == View.VISIBLE) {
                        finish()
                    } else if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            loadBase()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            allowFileAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            userAgentString = userAgentString + " MajedAndroid/1.0"
        }
        webView.addJavascriptInterface(MajedJsBridge(this), "MajedAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                mainFrameFailed = false
                hideError()
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipe.isRefreshing = false
                progress.visibility = View.GONE
                if (!mainFrameFailed) {
                    hideError()
                    injectAndroidHooks()
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    swipe.isRefreshing = false
                    showError()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return handleNavigation(request.url)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                val bar = progress as android.widget.ProgressBar
                bar.progress = newProgress
                bar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            enqueueSystemDownload(url, userAgent, contentDisposition, mimeType)
        }
    }

    private fun handleNavigation(uri: Uri?): Boolean {
        if (uri == null) return false
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme == "tel" || scheme == "mailto" || scheme == "sms" || scheme == "whatsapp" || scheme == "intent") {
            openExternal(uri)
            return true
        }
        if (scheme == "http" || scheme == "https") {
            if (sameServer(uri)) return false
            openExternal(uri)
            return true
        }
        openExternal(uri)
        return true
    }

    private fun sameServer(uri: Uri): Boolean {
        val base = Uri.parse(currentBaseUrl())
        return uri.scheme.equals(base.scheme, ignoreCase = true) &&
            uri.host.equals(base.host, ignoreCase = true)
    }

    fun isTrustedPage(): Boolean {
        val current = webView.url ?: return false
        return sameServer(Uri.parse(current))
    }

    private fun injectAndroidHooks() {
        webView.evaluateJavascript(ANDROID_HOOK, null)
    }

    private fun loadBase() {
        mainFrameFailed = false
        hideError()
        webView.loadUrl(currentBaseUrl())
    }

    private fun currentBaseUrl(): String {
        return getSharedPreferences(PREFS, MODE_PRIVATE)
            .getString(KEY_URL, getString(R.string.default_server_url))
            ?.trim()
            ?.trimEnd('/')
            ?.ifBlank { getString(R.string.default_server_url) }
            ?: getString(R.string.default_server_url)
    }

    fun showServerDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_server, null)
        val input = view.findViewById<EditText>(R.id.serverUrl)
        input.setText(currentBaseUrl())
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.server_url)
            .setView(view)
            .setPositiveButton(R.string.save_open, null)
            .setNegativeButton(R.string.cancel, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val normalized = normalizeUrl(input.text?.toString().orEmpty())
                if (normalized == null) {
                    toast(getString(R.string.invalid_url))
                    return@setOnClickListener
                }
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(KEY_URL, normalized)
                    .apply()
                webView.clearHistory()
                loadBase()
                dialog.dismiss()
            }
        }
        dialog.show()
    }

    private fun confirmClearSession() {
        AlertDialog.Builder(this)
            .setTitle(R.string.clear_title)
            .setMessage(R.string.clear_message)
            .setPositiveButton(R.string.clear_confirm) { _, _ -> clearSession() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun clearSession() {
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearHistory()
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            runOnUiThread {
                toast(getString(R.string.session_cleared))
                loadBase()
            }
        }
    }

    fun copyToClipboard(text: String) {
        val clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText("majed", text))
    }

    fun startAuthorizedDownload(path: String, filename: String, bearer: String, legacyPassword: String) {
        val safePath = sanitizePath(path) ?: run {
            toast(getString(R.string.download_failed))
            return
        }
        val request = DownloadRequest(
            path = safePath,
            filename = sanitizeFilename(filename),
            bearer = bearer,
            legacyPassword = legacyPassword,
            baseUrl = currentBaseUrl(),
        )
        if (
            Build.VERSION.SDK_INT <= 28 &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = request
            writePermission.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        io.execute { downloadOnBackground(request) }
    }

    private fun downloadOnBackground(request: DownloadRequest) {
        val connection = (URL(request.baseUrl + request.path).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 20_000
            readTimeout = 60_000
            if (request.bearer.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer ${request.bearer}")
            }
            if (request.legacyPassword.isNotBlank()) {
                setRequestProperty("X-Admin-Password", request.legacyPassword)
            }
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                reportDownload(getString(R.string.download_failed), false)
                return
            }
            connection.inputStream.use { input -> saveToDownloads(request.filename, input) }
            reportDownload(getString(R.string.download_saved, request.filename), true)
        } catch (_: Exception) {
            reportDownload(getString(R.string.download_failed), false)
        } finally {
            connection.disconnect()
        }
    }

    private fun saveToDownloads(filename: String, input: java.io.InputStream) {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.MIME_TYPE, "application/json")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("media store insert failed")
            contentResolver.openOutputStream(uri)?.use { output -> input.copyTo(output) }
                ?: error("output stream missing")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
        } else {
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!dir.exists()) dir.mkdirs()
            File(dir, filename).outputStream().use { output -> input.copyTo(output) }
        }
    }

    private fun reportDownload(message: String, ok: Boolean) {
        runOnUiThread {
            toast(message)
            if (!isTrustedPage()) return@runOnUiThread
            val escaped = message.replace("\\", "\\\\").replace("'", "\\'")
            webView.evaluateJavascript(
                "try{var st=document.getElementById('backupStatus');if(st){st.classList.remove('hidden');st.textContent='$escaped';}}catch(e){}",
                null,
            )
            if (!ok) {
                webView.evaluateJavascript(
                    "try{if(window.showToast)window.showToast('$escaped',false);}catch(e){}",
                    null,
                )
            }
        }
    }

    private fun enqueueSystemDownload(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        try {
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url).orEmpty())
                addRequestHeader("User-Agent", userAgent)
                if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
                setTitle(name)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
            }
            getSystemService(DownloadManager::class.java).enqueue(request)
            toast(getString(R.string.download_started))
        } catch (_: Exception) {
            toast(getString(R.string.download_failed))
        }
    }

    private fun openExternal(uri: Uri) {
        try {
            val intent = if (uri.scheme.equals("intent", ignoreCase = true)) {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
            } else {
                Intent(Intent.ACTION_VIEW, uri)
            }
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            toast(getString(R.string.no_app))
        } catch (_: Exception) {
            toast(getString(R.string.no_app))
        }
    }

    private fun showError() {
        errorPanel.visibility = View.VISIBLE
        progress.visibility = View.GONE
        swipe.isRefreshing = false
    }

    private fun hideError() {
        errorPanel.visibility = View.GONE
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        if (isFinishing) {
            webView.destroy()
        }
        super.onDestroy()
    }

    private data class DownloadRequest(
        val path: String,
        val filename: String,
        val bearer: String,
        val legacyPassword: String,
        val baseUrl: String,
    )

    companion object {
        private const val PREFS = "majed_prefs"
        private const val KEY_URL = "base_url"

        private val ANDROID_HOOK = """
            (function(){
              document.documentElement.classList.add('android-app');
              var nav = document.querySelector('.nav');
              if (!nav || document.getElementById('navAndroidSettings')) return;
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.id = 'navAndroidSettings';
              btn.className = 'nav-item';
              btn.innerHTML = '<span class="nav-icon">⚙️</span><span>رابط التطبيق</span>';
              btn.addEventListener('click', function(e){
                e.preventDefault();
                if (window.MajedAndroid && MajedAndroid.openAppSettings) MajedAndroid.openAppSettings();
              });
              nav.appendChild(btn);
            })();
        """.trimIndent()

        private fun normalizeUrl(raw: String): String? {
            var value = raw.trim()
            if (value.isEmpty()) return null
            if (!value.startsWith("http://") && !value.startsWith("https://")) {
                value = "https://$value"
            }
            val uri = Uri.parse(value)
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return null
            if (uri.host.isNullOrBlank()) return null
            return value.trimEnd('/')
        }

        private fun sanitizePath(path: String): String? {
            if (!path.startsWith("/api/")) return null
            if (path.contains("..") || path.contains("\\") || path.contains("\n") || path.contains("\r")) {
                return null
            }
            return path
        }

        private fun sanitizeFilename(name: String): String {
            val cleaned = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
            return cleaned.ifBlank { "customers-backup.json" }
        }
    }
}
