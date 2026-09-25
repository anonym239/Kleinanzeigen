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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

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
    /** Veröffentlichte Webseite (Branch "live") – die App zeigt immer genau diesen Stand. */
    private static final String LIVE_BASE = "https://raw.githubusercontent.com/anonym239/Kleinanzeigen/live/";
    private static final String LIVE_URL = "https://" + HOST + "/live/index.html";
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
                .addPathHandler("/live/", new LiveHandler())
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
            webView.loadUrl(remoteUrl.isEmpty() ? LIVE_URL : remoteUrl);
        }
    }

    /**
     * Liefert die Dateien der Webseite aus dem GitHub-Branch "live" (gleicher Stand wie Netlify).
     * Jede geladene Datei wird zwischengespeichert; ohne Netz kommt die letzte Kopie,
     * beim allerersten Start ohne Netz die in der App eingebaute Oberfläche.
     */
    private class LiveHandler implements WebViewAssetLoader.PathHandler {
        @Override
        public WebResourceResponse handle(String path) {
            if (path.isEmpty() || path.endsWith("/")) path += "index.html";
            if (path.contains("..")) return null;
            String mime = mimeFor(path);
            File cached = new File(getCacheDir(), "live/" + path);
            byte[] data = download(LIVE_BASE + path);
            if (data != null) {
                try {
                    File parent = cached.getParentFile();
                    if (parent != null) parent.mkdirs();
                    try (FileOutputStream out = new FileOutputStream(cached)) { out.write(data); }
                } catch (IOException ignored) { }
                return response(mime, new ByteArrayInputStream(data));
            }
            try {
                if (cached.isFile()) return response(mime, new FileInputStream(cached));
                return response(mime, getAssets().open("www/" + path)); // eingebaute Oberfläche
            } catch (IOException e) {
                return null;
            }
        }
    }

    private static WebResourceResponse response(String mime, InputStream in) {
        WebResourceResponse r = new WebResourceResponse(mime, "utf-8", in);
        java.util.Map<String, String> h = new java.util.HashMap<>();
        h.put("Cache-Control", "no-cache");
        r.setResponseHeaders(h);
        return r;
    }

    private static byte[] download(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                byte[] b = new byte[16384];
                int n;
                while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                return buf.toByteArray();
            }
        } catch (IOException e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
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
