package app.pulsewake.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int OPEN_TRACK = 17;
    private static final int SAVE_MP3 = 18;
    private Mp3Export mp3Export;
    private Mp3Export pickerOwner;
    private String pickerRequest;
    private static final int BACKGROUND = 0xff0c1020;
    private static final String TAG = "Pulsewake";
    private WebView web;
    private ValueCallback<Uri[]> fileResult;
    private boolean immersiveUnavailable;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        startGame(false);
    }

    private void startGame(boolean softwareRendering) {
        if (isFinishing() || isDestroyed()) return;
        try {
            launchWebView(softwareRendering);
        } catch (RuntimeException | LinkageError failure) {
            Log.e(TAG, "Could not start WebView", failure);
            showLaunchError();
        }
    }

    private void launchWebView(boolean softwareRendering) {
        web = new WebView(this);
        if (softwareRendering) web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(BACKGROUND);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        GameAssets assets = new GameAssets(getAssets());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                if (view == web) closeMp3Export();
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (view == web && mp3Export == null && Mp3Export.trustedPage(url) && Mp3Export.trustedPage(view.getUrl())) {
                    mp3Export = new Mp3Export(MainActivity.this, view);
                }
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.serve(request);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame() || GameAssets.isLocal(uri)) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException unavailable) {
                        Toast.makeText(MainActivity.this, R.string.cannot_open_link, Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }

            @Override public void onPageCommitVisible(WebView view, String url) {
                if (view == web && hasWindowFocus()) hideSystemBars();
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (web != view) return true;
                Log.w(TAG, "WebView renderer exited, crash=" + detail.didCrash());
                disposeWebView();
                if (softwareRendering) showLaunchError();
                else getWindow().getDecorView().post(() -> startGame(true));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result, FileChooserParams params) {
                if (fileResult != null) {
                    result.onReceiveValue(null);
                    return true;
                }
                fileResult = result;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "audio/*", "video/*" })
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(intent, OPEN_TRACK);
                } catch (ActivityNotFoundException unavailable) {
                    deliverFile(null);
                    Toast.makeText(MainActivity.this, R.string.cannot_open_files, Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(GameAssets.HOME);
    }

    void chooseExportDocument(Mp3Export owner, String id, String filename) {
        if (pickerOwner != null || owner != mp3Export || isDestroyed() || isFinishing()) {
            owner.documentPicked(id, null, true);
            return;
        }
        pickerOwner = owner;
        pickerRequest = id;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType("audio/mpeg")
            .putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(intent, SAVE_MP3); }
        catch (ActivityNotFoundException unavailable) {
            pickerOwner = null;
            pickerRequest = null;
            owner.documentPicked(id, null, true);
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        Uri uri = result == RESULT_OK && intent != null ? intent.getData() : null;
        if (request == SAVE_MP3) {
            if (pickerOwner != null) pickerOwner.documentPicked(pickerRequest, uri, false);
            pickerOwner = null;
            pickerRequest = null;
            return;
        }
        if (request != OPEN_TRACK) return;
        deliverFile(uri != null && "content".equals(uri.getScheme()) ? new Uri[] {uri} : null);
    }

    private void deliverFile(Uri[] selection) {
        ValueCallback<Uri[]> callback = fileResult;
        fileResult = null;
        if (callback != null) callback.onReceiveValue(selection);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && web != null) hideSystemBars();
    }

    private void hideSystemBars() {
        if (immersiveUnavailable) return;
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                getWindow().setDecorFitsSystemWindows(false);
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    controller.hide(WindowInsets.Type.systemBars());
                }
            } else {
                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
        } catch (RuntimeException unavailable) {
            immersiveUnavailable = true;
            Log.w(TAG, "Immersive mode is unavailable", unavailable);
        }
    }

    @Override protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('pulsewake-pause'))", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.dispatchEvent(new Event('pulsewake-resume'))", null);
        }
    }

    @Override public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(() => { if (window.pulsewakeBack && window.pulsewakeBack()) return true; const d=document.querySelector('dialog[open]'); " +
            "if (d) { d.close(); return true; } " +
            "if (location.hash === '#play') { document.getElementById('back-button').click(); return true; } " +
            "return false; })()", handled -> {
                if (web == null || isFinishing() || isDestroyed() || "true".equals(handled)) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            });
    }

    private void showLaunchError() {
        disposeWebView();
        if (isFinishing() || isDestroyed()) return;
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        int spacing = Math.round(32 * getResources().getDisplayMetrics().density);
        column.setPadding(spacing, spacing, spacing, spacing);
        column.setBackgroundColor(BACKGROUND);
        for (int text : new int[] { R.string.launch_failed, R.string.update_webview }) {
            TextView label = new TextView(this);
            label.setGravity(Gravity.CENTER);
            label.setTextColor(Color.WHITE);
            label.setTextSize(text == R.string.launch_failed ? 23 : 15);
            label.setPadding(0, 0, 0, spacing / 3);
            label.setText(text);
            column.addView(label);
        }
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(v -> startGame(false));
        column.addView(retry);
        setContentView(column);
    }

    private void closeMp3Export() {
        if (mp3Export != null) mp3Export.close();
        mp3Export = null;
    }

    private void disposeWebView() {
        closeMp3Export();
        deliverFile(null);
        if (web == null) return;
        WebView old = web;
        web = null;
        setContentView(new View(this));
        old.destroy();
    }

    @Override protected void onDestroy() {
        disposeWebView();
        super.onDestroy();
    }
}
