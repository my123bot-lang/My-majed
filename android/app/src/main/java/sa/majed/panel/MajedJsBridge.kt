package sa.majed.panel

import android.webkit.JavascriptInterface

/**
 * Methods exposed to the admin page as `window.MajedAndroid`.
 * Calls are ignored unless the WebView is still on the configured server.
 */
class MajedJsBridge(
    private val activity: MainActivity,
) {
    @JavascriptInterface
    fun openAppSettings() {
        activity.runOnUiThread {
            if (!activity.isTrustedPage()) return@runOnUiThread
            activity.showServerDialog()
        }
    }

    @JavascriptInterface
    fun copyText(text: String?) {
        activity.runOnUiThread {
            if (!activity.isTrustedPage()) return@runOnUiThread
            activity.copyToClipboard(text.orEmpty())
        }
    }

    @JavascriptInterface
    fun downloadAuthorized(path: String?, filename: String?, bearer: String?, legacyPassword: String?) {
        activity.runOnUiThread {
            if (!activity.isTrustedPage()) return@runOnUiThread
            activity.startAuthorizedDownload(
                path.orEmpty(),
                filename.orEmpty(),
                bearer.orEmpty(),
                legacyPassword.orEmpty(),
            )
        }
    }
}
