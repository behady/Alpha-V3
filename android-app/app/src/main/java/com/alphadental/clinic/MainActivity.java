package com.alphadental.clinic;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;
import java.io.IOException;
import java.util.Locale;

/**
 * A native shell around the Alpha Dental web system.
 *
 * <p>The heavy lifting all lives on the website; this class exists to make the
 * website behave like a real Android app — hardware back button, pull to
 * refresh, working file uploads and downloads, phone/WhatsApp links opening in
 * the right app, and a readable screen when the network drops.
 */
public class MainActivity extends AppCompatActivity implements DownloadBridge.Listener {

    private static final String TAG = "AlphaDental";
    private static final String STATE_WEB_VIEW = "alpha.webview.state";
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000L;

    private ViewGroup root;
    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private View errorPanel;
    private TextView errorMessage;

    private final PageStateBridge pageState = new PageStateBridge();

    private boolean mainFrameFailed;
    private long lastBackPressAt;

    private ValueCallback<Uri[]> fileChooserCallback;
    private Uri pendingCameraOutput;

    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String> storagePermissionLauncher;

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // Swap the splash background out for the real window background.
        setTheme(R.style.Theme_AlphaDental);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        root = findViewById(R.id.root);
        webView = findViewById(R.id.web_view);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        progressBar = findViewById(R.id.progress);
        errorPanel = findViewById(R.id.error_panel);
        errorMessage = findViewById(R.id.error_message);

        registerLaunchers();
        applyEdgeToEdgeInsets();
        configureWebView();
        configurePullToRefresh();
        configureBackButton();

        findViewById(R.id.error_retry).setOnClickListener(v -> reload());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState.getBundle(STATE_WEB_VIEW));
        } else {
            webView.loadUrl(AppConfig.START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        Bundle webState = new Bundle();
        webView.saveState(webState);
        outState.putBundle(STATE_WEB_VIEW, webState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        // Detach before destroying, otherwise the WebView leaks the Activity.
        ViewGroup parent = (ViewGroup) webView.getParent();
        if (parent != null) {
            parent.removeView(webView);
        }
        webView.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------- setup

    private void registerLaunchers() {
        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> deliverChosenFiles(result.getResultCode(), result.getData()));

        storagePermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> toast(granted
                        ? getString(R.string.storage_permission_granted)
                        : getString(R.string.storage_permission_denied)));
    }

    /** Draw behind the status and navigation bars, then pad the content back in. */
    private void applyEdgeToEdgeInsets() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return windowInsets;
        });
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + AppConfig.USER_AGENT_SUFFIX);

        // Pinch-zoom without the on-screen buttons, so x-rays and charts can be
        // inspected closely.
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // The page never needs to reach the device's own storage.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        // Safe because navigation is locked to our own hosts (see AppConfig);
        // no third-party page is ever loaded in this WebView.
        webView.addJavascriptInterface(
                new DownloadBridge(getCacheDir(), this), "AlphaDownloader");
        webView.addJavascriptInterface(pageState, "AlphaPage");

        webView.setWebViewClient(new AlphaWebViewClient());
        webView.setWebChromeClient(new AlphaWebChromeClient());
        webView.setDownloadListener(this::startSystemDownload);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    }

    private void configurePullToRefresh() {
        swipeRefresh.setOnRefreshListener(this::reload);
        // Refuse the gesture unless everything is genuinely scrolled to the
        // top — both the WebView and whichever box on the page is doing the
        // scrolling. Otherwise scrolling back up a patient list would reload.
        swipeRefresh.setOnChildScrollUpCallback(
                (parent, child) -> webView.getScrollY() > 0 || !pageState.isScrolledToTop());
    }

    private void configureBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    mainFrameFailed = false;
                    errorPanel.setVisibility(View.GONE);
                    webView.goBack();
                    return;
                }
                long now = SystemClock.elapsedRealtime();
                if (now - lastBackPressAt < EXIT_CONFIRM_WINDOW_MS) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                } else {
                    lastBackPressAt = now;
                    toast(getString(R.string.press_back_again));
                }
            }
        });
    }

    // -------------------------------------------------------------- navigation

    private void reload() {
        mainFrameFailed = false;
        errorPanel.setVisibility(View.GONE);
        if (TextUtils.isEmpty(webView.getUrl())) {
            webView.loadUrl(AppConfig.START_URL);
        } else {
            webView.reload();
        }
    }

    /**
     * @return true when the link was dealt with outside the app and the WebView
     *         should not follow it.
     */
    private boolean routeAwayFromApp(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        switch (scheme) {
            case "":
            case "about":
            case "javascript":
            case "blob":
            case "data":
                return false;

            case "http":
            case "https":
                if (AppConfig.isBlockedOAuthUrl(uri)) {
                    showGoogleSignInNotice();
                    return true;
                }
                if (AppConfig.isInAppUrl(uri)) {
                    return false;
                }
                openOutside(uri);
                return true;

            case "intent":
                openIntentLink(uri);
                return true;

            default:
                // tel:, mailto:, sms:, whatsapp:, geo:, market: and anything else
                // the phone knows how to handle.
                openOutside(uri);
                return true;
        }
    }

    private void openOutside(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            toast(getString(R.string.no_app_for_link));
        }
    }

    private void openIntentLink(Uri uri) {
        try {
            Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException notInstalled) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null) {
                    openOutside(Uri.parse(fallback));
                } else {
                    toast(getString(R.string.no_app_for_link));
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Unusable intent link: " + uri, e);
            toast(getString(R.string.no_app_for_link));
        }
    }

    private void showGoogleSignInNotice() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.google_signin_title)
                .setMessage(R.string.google_signin_message)
                .setPositiveButton(android.R.string.ok, null)
                .show();
    }

    private void showError(String description) {
        mainFrameFailed = true;
        errorMessage.setText(description);
        errorPanel.setVisibility(View.VISIBLE);
        swipeRefresh.setRefreshing(false);
        progressBar.setVisibility(View.GONE);
    }

    // ----------------------------------------------------------- system colours

    /** Match the status bar to whatever background the page is actually using. */
    private void syncSystemBarsWithPage() {
        webView.evaluateJavascript(DownloadScripts.READ_PAGE_BACKGROUND, value -> {
            Integer colour = parseCssColour(value);
            if (colour == null) {
                return;
            }
            root.setBackgroundColor(colour);
            boolean lightBackground = luminanceOf(colour) > 0.5;
            WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), root);
            controller.setAppearanceLightStatusBars(lightBackground);
            controller.setAppearanceLightNavigationBars(lightBackground);
        });
    }

    /** Turns evaluateJavascript's {@code "\"rgb(26, 32, 44)\""} into a colour int. */
    @Nullable
    private static Integer parseCssColour(@Nullable String jsResult) {
        if (jsResult == null) {
            return null;
        }
        String text = jsResult.replace("\"", "").trim();
        int open = text.indexOf('(');
        int close = text.lastIndexOf(')');
        if (open < 0 || close <= open) {
            return null;
        }
        String[] parts = text.substring(open + 1, close).split(",");
        if (parts.length < 3) {
            return null;
        }
        try {
            int r = (int) Float.parseFloat(parts[0].trim());
            int g = (int) Float.parseFloat(parts[1].trim());
            int b = (int) Float.parseFloat(parts[2].trim());
            if (parts.length >= 4 && Float.parseFloat(parts[3].trim()) < 0.1f) {
                return null; // Fully transparent tells us nothing.
            }
            return Color.rgb(clampChannel(r), clampChannel(g), clampChannel(b));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int clampChannel(int value) {
        return Math.max(0, Math.min(255, value));
    }

    private static double luminanceOf(int colour) {
        return (0.299 * Color.red(colour)
                + 0.587 * Color.green(colour)
                + 0.114 * Color.blue(colour)) / 255.0;
    }

    // ------------------------------------------------------------- file uploads

    private Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params) {
        Intent content = params.createIntent();
        content.addCategory(Intent.CATEGORY_OPENABLE);

        Intent chooser = new Intent(Intent.ACTION_CHOOSER);
        chooser.putExtra(Intent.EXTRA_INTENT, content);
        chooser.putExtra(Intent.EXTRA_TITLE, getString(R.string.file_chooser_title));

        Intent camera = buildCameraIntent(params);
        if (camera != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        return chooser;
    }

    /**
     * Lets staff photograph a tooth, an x-ray or a document straight into an
     * upload field instead of having to leave the app first.
     */
    @Nullable
    private Intent buildCameraIntent(WebChromeClient.FileChooserParams params) {
        if (!acceptsImages(params)) {
            return null;
        }
        Intent capture = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
        if (capture.resolveActivity(getPackageManager()) == null) {
            return null;
        }
        try {
            File uploads = new File(getCacheDir(), "uploads");
            //noinspection ResultOfMethodCallIgnored
            uploads.mkdirs();
            File photo = File.createTempFile("capture-", ".jpg", uploads);
            pendingCameraOutput = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", photo);
            capture.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, pendingCameraOutput);
            capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return capture;
        } catch (IOException e) {
            Log.w(TAG, "Could not prepare a camera file", e);
            pendingCameraOutput = null;
            return null;
        }
    }

    private static boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        String[] accepted = params.getAcceptTypes();
        if (accepted == null || accepted.length == 0) {
            return true;
        }
        for (String type : accepted) {
            if (type == null || type.trim().isEmpty()) {
                return true;
            }
            String lower = type.toLowerCase(Locale.ROOT);
            if (lower.startsWith("image/") || lower.equals("*/*") || lower.startsWith(".jp")
                    || lower.startsWith(".png")) {
                return true;
            }
        }
        return false;
    }

    /**
     * Hands the picked files back to the page. Passing null on cancel matters —
     * without it the upload field stays stuck and never responds again.
     */
    private void deliverChosenFiles(int resultCode, @Nullable Intent data) {
        if (fileChooserCallback == null) {
            pendingCameraOutput = null;
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data == null || (data.getData() == null && data.getClipData() == null)) {
                // Nothing came back in the Intent, so it was the camera writing
                // into the file we supplied.
                if (pendingCameraOutput != null) {
                    results = new Uri[]{pendingCameraOutput};
                }
            } else if (data.getClipData() != null) {
                ClipData clip = data.getClipData();
                results = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) {
                    results[i] = clip.getItemAt(i).getUri();
                }
            } else {
                results = new Uri[]{data.getData()};
            }
        }
        fileChooserCallback.onReceiveValue(results);
        fileChooserCallback = null;
        pendingCameraOutput = null;
    }

    // ----------------------------------------------------------------- downloads

    /** Ordinary http(s) downloads, e.g. a file stored in Firebase Storage. */
    private void startSystemDownload(String url, String userAgent, String contentDisposition,
                                     String mimeType, long contentLength) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // These are handled by the injected script; reaching here means the
            // page produced one in a way we could not intercept.
            toast(getString(R.string.download_failed, getString(R.string.download_unsupported)));
            return;
        }
        if (!needsLegacyStoragePermission()) {
            enqueueDownload(url, userAgent, contentDisposition, mimeType);
        }
    }

    private void enqueueDownload(String url, String userAgent, String contentDisposition,
                                 String mimeType) {
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("User-Agent", userAgent);
            request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            request.setMimeType(mimeType);
            request.setTitle(name);
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                toast(getString(R.string.download_failed,
                        getString(R.string.download_unsupported)));
                return;
            }
            manager.enqueue(request);
            toast(getString(R.string.download_started, name));
        } catch (Exception e) {
            Log.w(TAG, "Download could not be queued", e);
            toast(getString(R.string.download_failed, String.valueOf(e.getMessage())));
        }
    }

    /**
     * Android 8 and 9 still need an explicit storage permission.
     *
     * @return true when we had to stop and ask for it.
     */
    private boolean needsLegacyStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return false;
        }
        boolean granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            return false;
        }
        storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        return true;
    }

    @Override
    public void onDownloadSaved(Uri uri, String displayName, String mimeType) {
        runOnUiThread(() -> showSavedFileDialog(uri, displayName, mimeType));
    }

    @Override
    public void onDownloadFailed(String displayName, String reason) {
        runOnUiThread(() -> toast(getString(R.string.download_failed, reason)));
    }

    private void showSavedFileDialog(Uri uri, String displayName, String mimeType) {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.download_saved_title)
                .setMessage(getString(R.string.download_saved_message, displayName))
                .setPositiveButton(R.string.action_open, (d, w) -> openSavedFile(uri, mimeType))
                .setNeutralButton(R.string.action_share, (d, w) -> shareSavedFile(uri, mimeType))
                .setNegativeButton(R.string.action_close, null)
                .show();
    }

    private void openSavedFile(Uri uri, String mimeType) {
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(uri, TextUtils.isEmpty(mimeType) ? "*/*" : mimeType);
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(view);
        } catch (ActivityNotFoundException e) {
            toast(getString(R.string.no_app_for_file));
        }
    }

    private void shareSavedFile(Uri uri, String mimeType) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType(TextUtils.isEmpty(mimeType) ? "*/*" : mimeType);
        share.putExtra(Intent.EXTRA_STREAM, uri);
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(share, getString(R.string.action_share)));
        } catch (ActivityNotFoundException e) {
            toast(getString(R.string.no_app_for_file));
        }
    }

    // -------------------------------------------------------------- web clients

    private final class AlphaWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return routeAwayFromApp(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            mainFrameFailed = false;
            pageState.reset();
            errorPanel.setVisibility(View.GONE);
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            swipeRefresh.setRefreshing(false);
            progressBar.setVisibility(View.GONE);
            if (!mainFrameFailed) {
                view.evaluateJavascript(DownloadScripts.INSTALL_DOWNLOAD_HOOK, null);
                view.evaluateJavascript(DownloadScripts.INSTALL_SCROLL_REPORTER, null);
                syncSystemBarsWithPage();
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    WebResourceError error) {
            // Only a failure of the page itself is worth a full-screen message;
            // a single missing image is not.
            if (!request.isForMainFrame()) {
                return;
            }
            showError(getString(R.string.error_offline));
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail d) {
            // The browser engine was killed, usually under memory pressure.
            // Restarting beats letting the whole app crash.
            Log.w(TAG, "WebView render process gone; restarting the screen");
            if (!isFinishing()) {
                recreate();
            }
            return true;
        }
    }

    private final class AlphaWebChromeClient extends WebChromeClient {

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
            }
            fileChooserCallback = callback;
            try {
                fileChooserLauncher.launch(buildFileChooserIntent(params));
                return true;
            } catch (ActivityNotFoundException e) {
                fileChooserCallback = null;
                pendingCameraOutput = null;
                toast(getString(R.string.no_app_for_files));
                return false;
            }
        }

        /** Handles links that ask for a new tab, e.g. target="_blank". */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                      Message resultMsg) {
            WebView probe = new WebView(view.getContext());
            probe.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView probeView, WebResourceRequest req) {
                    Uri target = req.getUrl();
                    if (!routeAwayFromApp(target)) {
                        webView.loadUrl(target.toString());
                    }
                    probeView.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(probe);
            resultMsg.sendToTarget();
            return true;
        }

        /** The clinic system never asks for the camera or microphone directly. */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin, android.webkit.GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }

    // ---------------------------------------------------------------- utilities

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
