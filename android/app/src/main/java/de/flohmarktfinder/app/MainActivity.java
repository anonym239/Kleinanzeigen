package de.flohmarktfinder.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

/**
 * Flohmarkt-Finder als Android-App.
 *
 * Die Oberfläche liegt in der App (assets/www) und wird über https://appassets.androidplatform.net geladen,
 * damit Speicher (Favoriten, Notizen) und Netzwerkzugriffe wie auf der Webseite funktionieren.
 * Die Termine lädt die Seite selbst aus dem GitHub-Branch "live".
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private WebView webView;
    private String remoteUrl = "";   // Webseite (z.B. Netlify); leer = eingebaute Oberfläche
    private String remoteHost = "";
    private boolean usingFallback = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#0e6f60"));

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        remoteUrl = getString(R.string.app_url).trim();
        remoteHost = remoteUrl.isEmpty() ? "" : String.valueOf(Uri.parse(remoteUrl).getHost());
        WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);          // Favoriten, Notizen, Wohnort
        ws.setDatabaseEnabled(true);
        ws.setSupportMultipleWindows(false);    // target=_blank im selben Fenster -> wird unten abgefangen
        ws.setAllowFileAccess(false);
        ws.setTextZoom(100);

        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                // Webseite nicht erreichbar -> eingebaute Oberfläche verwenden (lädt die Termine selbst)
                if (request.isForMainFrame() && !usingFallback && !remoteUrl.isEmpty()) {
                    usingFallback = true;
                    view.loadUrl(START_URL);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (HOST.equals(host) || (!remoteHost.isEmpty() && remoteHost.equals(host))) {
                    return false; // eigene Seiten in der App
                }
                openExternal(uri); // Anzeige, Route (Google Maps) usw. in der passenden App öffnen
                return true;
            }
        });

        setContentView(webView);
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(remoteUrl.isEmpty() ? START_URL : remoteUrl);
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Keine App zum Öffnen gefunden", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // Offene Fenster (Details, Einstellungen) schließt die Seite selbst; sonst App verlassen
        webView.evaluateJavascript(
                "(function(){var d=[...document.querySelectorAll('dialog[open]')];" +
                "var f=document.querySelector('.filters.open');" +
                "if(d.length){d.forEach(function(x){x.close()});return 'handled'}" +
                "if(f){f.classList.remove('open');return 'handled'}return 'exit'})()",
                value -> {
                    if (value == null || !value.contains("handled")) {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    /** Funktionen, die die Webseite in der App aufrufen kann (window.AndroidApp). */
    private class Bridge {
        @JavascriptInterface
        public void share(String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, "Termin teilen")));
        }

        @JavascriptInterface
        public void addToCalendar(String title, double beginMillis, double endMillis, String location, String description) {
            Intent intent = new Intent(Intent.ACTION_INSERT)
                    .setData(CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) beginMillis)
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, (long) endMillis)
                    .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
                    .putExtra(CalendarContract.Events.TITLE, title)
                    .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                    .putExtra(CalendarContract.Events.DESCRIPTION, description);
            runOnUiThread(() -> {
                try {
                    startActivity(intent);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "Keine Kalender-App gefunden", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(Uri.parse(url)));
        }
    }
}
