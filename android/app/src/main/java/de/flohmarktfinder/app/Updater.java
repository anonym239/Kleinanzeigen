package de.flohmarktfinder.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * App-Update direkt aus der App: prüft auf GitHub, ob es eine neuere Version gibt, lädt sie herunter und
 * öffnet den Android-Installer. Die neue Version wird über die alte installiert – nichts löschen, Gemerktes bleibt.
 * (Android verlangt aus Sicherheitsgründen, dass man „Aktualisieren“ einmal antippt.)
 */
final class Updater {
    private static final String REPO = "https://github.com/anonym239/Kleinanzeigen";
    private static final String LATEST = REPO + "/releases/latest";
    private static final Pattern TAG = Pattern.compile("/tag/app-v1\\.(\\d+)");
    private static final long CHECK_EVERY = 6 * 60 * 60 * 1000L; // höchstens alle 6 Stunden nachsehen
    private static boolean busy = false;

    private Updater() { }

    static int currentVersion(Context c) {
        try {
            //noinspection deprecation
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("updater", Context.MODE_PRIVATE);
    }

    /** Neueste veröffentlichte Versionsnummer (aus der Weiterleitung von /releases/latest), 0 = unbekannt. */
    static int latestVersion() {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(LATEST).openConnection();
            con.setInstanceFollowRedirects(false);
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            String loc = con.getHeaderField("Location");
            if (loc == null) return 0;
            Matcher m = TAG.matcher(loc);
            return m.find() ? Integer.parseInt(m.group(1)) : 0;
        } catch (IOException | NumberFormatException e) {
            return 0;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    /** Beim Start: gelegentlich nachsehen und bei neuer Version fragen. */
    static void checkInBackground(Activity a, boolean force) {
        SharedPreferences p = prefs(a);
        long now = System.currentTimeMillis();
        if (!force && now - p.getLong("lastCheck", 0) < CHECK_EVERY) return;
        p.edit().putLong("lastCheck", now).apply();
        new Thread(() -> {
            int latest = latestVersion();
            int current = currentVersion(a);
            a.runOnUiThread(() -> {
                if (a.isFinishing()) return;
                if (latest > current) {
                    if (!force && p.getInt("skipped", 0) == latest && now - p.getLong("skippedAt", 0) < 24 * 60 * 60 * 1000L) return;
                    ask(a, latest);
                } else if (force) {
                    Toast.makeText(a, latest == 0 ? "Keine Verbindung zu GitHub – bitte später erneut versuchen"
                            : "Die App ist aktuell (Version 1." + current + ")", Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    private static void ask(Activity a, int latest) {
        new AlertDialog.Builder(a)
                .setTitle("Neue Version 1." + latest)
                .setMessage("Es gibt eine neue Version der Flohmarkt-App. Jetzt aktualisieren?\n\n"
                        + "Die alte App muss nicht gelöscht werden – alles Gemerkte bleibt erhalten.")
                .setPositiveButton("Jetzt aktualisieren", (d, w) -> downloadAndInstall(a, latest))
                .setNegativeButton("Später", (d, w) -> prefs(a).edit().putInt("skipped", latest)
                        .putLong("skippedAt", System.currentTimeMillis()).apply())
                .show();
    }

    /** Lädt die APK der Version (0 = neueste) und öffnet den Installer. */
    static void downloadAndInstall(Activity a, int version) {
        if (busy) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            // Einmalig erlauben: "Apps aus dieser Quelle installieren"
            new AlertDialog.Builder(a)
                    .setTitle("Einmal erlauben")
                    .setMessage("Damit die App sich selbst aktualisieren kann, im nächsten Fenster „Dieser Quelle vertrauen“ "
                            + "bzw. „Zulassen“ einschalten und dann zurückgehen. Danach startet das Update.")
                    .setPositiveButton("Weiter", (d, w) -> {
                        prefs(a).edit().putInt("pendingInstall", version == 0 ? -1 : version).apply();
                        try {
                            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + a.getPackageName())));
                        } catch (ActivityNotFoundException e) {
                            Toast.makeText(a, "Bitte in den Handy-Einstellungen erlauben", Toast.LENGTH_LONG).show();
                        }
                    })
                    .setNegativeButton("Abbrechen", null)
                    .show();
            return;
        }
        busy = true;
        Toast.makeText(a, "Update wird geladen …", Toast.LENGTH_LONG).show();
        new Thread(() -> {
            File apk = null;
            try {
                String url = version > 0
                        ? REPO + "/releases/download/app-v1." + version + "/Flohmarkt-Finder.apk"
                        : LATEST + "/download/Flohmarkt-Finder.apk";
                File dir = new File(a.getCacheDir(), "updates");
                dir.mkdirs();
                apk = new File(dir, "Flohmarkt-Finder.apk");
                download(url, apk);
            } catch (IOException e) {
                apk = null;
            }
            final File done = apk;
            a.runOnUiThread(() -> {
                busy = false;
                if (done == null) {
                    Toast.makeText(a, "Update konnte nicht geladen werden – bitte später erneut versuchen", Toast.LENGTH_LONG).show();
                    return;
                }
                Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".updates", done);
                Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    a.startActivity(install);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(a, "Installer nicht gefunden", Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    /** Nach der Rückkehr aus den Einstellungen ("Zulassen") das angefangene Update fortsetzen. */
    static void resumePending(Activity a) {
        SharedPreferences p = prefs(a);
        int pending = p.getInt("pendingInstall", 0);
        if (pending == 0) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) return;
        p.edit().remove("pendingInstall").apply();
        downloadAndInstall(a, pending < 0 ? 0 : pending);
    }

    private static void download(String url, File out) throws IOException {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setInstanceFollowRedirects(true);
            con.setConnectTimeout(15000);
            con.setReadTimeout(60000);
            if (con.getResponseCode() != 200) throw new IOException("HTTP " + con.getResponseCode());
            try (InputStream in = con.getInputStream(); FileOutputStream f = new FileOutputStream(out)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) > 0) f.write(b, 0, n);
            }
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
