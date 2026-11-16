package com.musicalhousie.app

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var offlineOverlay: LinearLayout
    private lateinit var adBannerContainer: FrameLayout
    private var bannerAdView: AdView? = null
    private var interstitialAd: InterstitialAd? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Keep screen active during live Musical Housie rounds (YouTube compliance)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = findViewById(R.id.webView)
        offlineOverlay = findViewById(R.id.offlineOverlay)
        adBannerContainer = findViewById(R.id.adBannerContainer)

        findViewById<Button>(R.id.retryButton).setOnClickListener {
            offlineOverlay.visibility = View.GONE
            webView.reload()
        }

        setupWebView()
        setupAdMob()
        handleDeepLinkOrLoadDefault(intent)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLinkOrLoadDefault(intent)
    }

    private fun handleDeepLinkOrLoadDefault(intent: Intent?) {
        val incomingUrl = intent?.dataString
        val appOrigin = BuildConfig.APP_URL.trimEnd('/')
        if (!incomingUrl.isNullOrBlank() && incomingUrl.startsWith(appOrigin)) {
            webView.loadUrl(incomingUrl)
        } else if (webView.url.isNullOrBlank()) {
            webView.loadUrl(appOrigin)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                val appOrigin = BuildConfig.APP_URL.trimEnd('/')

                // Keep internal app navigation & Google/Firebase OAuth inside WebView
                if (url.startsWith(appOrigin)) {
                    return false
                }

                // Route WhatsApp invites, YouTube watch links, and external URLs to native apps
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    true
                } catch (_: Exception) {
                    false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                offlineOverlay.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    offlineOverlay.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun setupAdMob() {
        MobileAds.initialize(this) {
            loadBannerAd()
            loadInterstitialAd()
        }
    }

    private fun loadBannerAd() {
        val adView = AdView(this).apply {
            adUnitId = BuildConfig.BANNER_AD_UNIT_ID
            setAdSize(AdSize.BANNER)
        }
        adBannerContainer.removeAllViews()
        adBannerContainer.addView(adView)
        adView.loadAd(AdRequest.Builder().build())
        bannerAdView = adView
    }

    private fun loadInterstitialAd() {
        InterstitialAd.load(
            this,
            BuildConfig.INTERSTITIAL_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: InterstitialAd) {
                    interstitialAd = ad
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    interstitialAd = null
                }
            }
        )
    }

    fun showInterstitialAdIfReady() {
        runOnUiThread {
            val ad = interstitialAd
            if (ad != null) {
                ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                    override fun onAdDismissedFullScreenContent() {
                        interstitialAd = null
                        loadInterstitialAd()
                    }
                }
                ad.show(this)
            } else {
                loadInterstitialAd()
            }
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun showInterstitial() {
            showInterstitialAdIfReady()
        }

        @JavascriptInterface
        fun shareInviteText(shareText: String) {
            runOnUiThread {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, shareText)
                }
                startActivity(Intent.createChooser(shareIntent, "Share Musical Housie Invite"))
            }
        }
    }

    // Required for YouTube & Google Play policy: pause media when app goes to background
    override fun onPause() {
        bannerAdView?.pause()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        bannerAdView?.resume()
    }

    override fun onDestroy() {
        bannerAdView?.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
