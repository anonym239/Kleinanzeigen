package de.flohmarktfinder.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.Manifest;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

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
        // Schriftgröße des Handys übernehmen wie andere Apps (begrenzt, damit das Layout ruhig bleibt)
        float scale = getResources().getConfiguration().fontScale;
        ws.setTextZoom(Math.round(Math.max(0.85f, Math.min(1.3f, scale)) * 100));

        // Kein automatisches Abdunkeln der Seite – sie hat ein eigenes, gut lesbares dunkles Design
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(ws, false);
        }
        if (Build.VERSION.SDK_INT >= 29) webView.setForceDarkAllowed(false);

        webView.addJavascriptInterface(new Bridge(), "AndroidApp");
        webView.setWebChromeClient(new android.webkit.WebChromeClient()); // Dialoge (z.B. PIN-Abfrage) erlauben
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
        Reminder.schedule(this); // Freitags-Erinnerung (falls eingeschaltet)
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
                "if(f){f.classList.remove('open');document.documentElement.classList.remove('filters-open');return 'handled'}return 'exit'})()",
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

        /** Einstellungen der Freitags-Erinnerung aus der Seite übernehmen. */
        @JavascriptInterface
        public void setReminder(boolean enabled, double lat, double lon, double radiusKm, String favIdsJson) {
            android.content.SharedPreferences p = Reminder.prefs(MainActivity.this);
            p.edit().putBoolean("enabled", enabled)
                    .putLong("lat", Double.doubleToRawLongBits(lat))
                    .putLong("lon", Double.doubleToRawLongBits(lon))
                    .putLong("radius", Double.doubleToRawLongBits(radiusKm))
                    .putString("favs", favIdsJson == null ? "[]" : favIdsJson)
                    .apply();
            Reminder.schedule(MainActivity.this);
            // Ab Android 13 muss man Benachrichtigungen einmal erlauben
            if (enabled && Build.VERSION.SDK_INT >= 33 && !p.getBoolean("asked", false)
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                p.edit().putBoolean("asked", true).apply();
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 5));
            }
        }

        /** "on", "off" oder "blocked" (Benachrichtigungen in den Handy-Einstellungen aus). */
        @JavascriptInterface
        public String reminderStatus() {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && !nm.areNotificationsEnabled()) return "blocked";
            return Reminder.prefs(MainActivity.this).getBoolean("enabled", true) ? "on" : "off";
        }

        /** Probe: die Freitags-Nachricht sofort zeigen. */
        @JavascriptInterface
        public void testReminder() {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && !nm.areNotificationsEnabled()) {
                if (Build.VERSION.SDK_INT >= 33) {
                    runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 5));
                } else {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this,
                            "Benachrichtigungen sind für die App ausgeschaltet (Handy-Einstellungen → Apps → Flohmärkte)",
                            Toast.LENGTH_LONG).show());
                }
                return;
            }
            new Thread(() -> Reminder.notifyWeekend(getApplicationContext())).start();
        }

        /** PDF (Base64) im Ordner "Download" speichern und gleich öffnen. */
        @JavascriptInterface
        public void savePdf(String base64, String fileName) {
            byte[] data;
            try {
                data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return;
            }
            String name = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
            try {
                Uri uri;
                if (Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues v = new android.content.ContentValues();
                    v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                    uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("kein Speicherplatz");
                    try (java.io.OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) throw new IOException("nicht beschreibbar");
                        out.write(data);
                    }
                } else {
                    File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS);
                    File f = new File(dir, name);
                    try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "PDF gespeichert: " + f.getAbsolutePath(), Toast.LENGTH_LONG).show());
                    return;
                }
                final Uri saved = uri;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "PDF gespeichert unter „Downloads“", Toast.LENGTH_LONG).show();
                    Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(saved, "application/pdf")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivity(view);
                    } catch (ActivityNotFoundException ignored) {
                        // keine PDF-App: Datei liegt trotzdem in Downloads
                    }
                });
            } catch (IOException | SecurityException e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "PDF konnte nicht gespeichert werden", Toast.LENGTH_LONG).show());
            }
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public int appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (PackageManager.NameNotFoundException e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(Uri.parse(url)));
        }
    }
}
