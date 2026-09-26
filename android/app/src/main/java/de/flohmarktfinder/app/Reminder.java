package de.flohmarktfinder.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Wochenend-Erinnerung: Jede Woche am eingestellten Tag (Standard Freitag) zur eingestellten Uhrzeit (Standard 7 Uhr) lädt die App die aktuellen Termine und meldet,
 * wie viele Flohmärkte am Wochenende im eingestellten Umkreis sind (mit den Top-Tipps).
 * Läuft auch, wenn die App geschlossen ist; nach einem Neustart des Handys wird sie neu geplant.
 */
public class Reminder extends BroadcastReceiver {
    static final String PREFS = "reminder";
    private static final String CHANNEL = "wochenende";
    static final int DEFAULT_HOUR = 7;
    private static final String[] DATA_URLS = {
            "https://raw.githubusercontent.com/anonym239/Kleinanzeigen/live/data/events.json",
            "https://cdn.jsdelivr.net/gh/anonym239/Kleinanzeigen@live/data/events.json",
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if ("de.flohmarktfinder.app.FRIDAY".equals(action)) {
            final PendingResult result = goAsync();
            new Thread(() -> {
                try {
                    notifyWeekend(context.getApplicationContext());
                } finally {
                    schedule(context); // nächste Woche
                    result.finish();
                }
            }).start();
        } else {
            schedule(context); // Handy neu gestartet oder App aktualisiert
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, Reminder.class).setAction("de.flohmarktfinder.app.FRIDAY");
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Plant den nächsten eingestellten Tag zur eingestellten Uhrzeit (oder hebt die Planung auf, wenn ausgeschaltet). */
    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(c);
        if (!prefs(c).getBoolean("enabled", true)) {
            am.cancel(pi);
            return;
        }
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, prefs(c).getInt("hour", DEFAULT_HOUR));
        next.set(Calendar.MINUTE, prefs(c).getInt("minute", 0));
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        int day = prefs(c).getInt("day", Calendar.FRIDAY);
        if (day < Calendar.SUNDAY || day > Calendar.SATURDAY) day = Calendar.FRIDAY;
        int days = (day - next.get(Calendar.DAY_OF_WEEK) + 7) % 7;
        next.add(Calendar.DAY_OF_MONTH, days);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_MONTH, 7);
        // Ungefähre Uhrzeit reicht (braucht keine Sonderberechtigung, schont den Akku)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pi);
    }

    /** Lädt die Termine, zählt das Wochenende und zeigt die Benachrichtigung. */
    static void notifyWeekend(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Wochenend-Überblick",
                NotificationManager.IMPORTANCE_DEFAULT));

        String title;
        String text;
        String big;
        JSONObject data = load();
        if (data == null) {
            title = "Flohmärkte am Wochenende";
            text = "Schau rein, was am Wochenende los ist.";
            big = text;
        } else {
            Summary s = summarize(c, data);
            title = s.total == 0 ? "Am Wochenende" : s.total + " Flohmärkte am Wochenende";
            StringBuilder t = new StringBuilder();
            if (s.total == 0) {
                t.append("Für dieses Wochenende ist in deinem Umkreis noch nichts eingetragen.");
            } else {
                t.append(s.radius > 0 ? "Im Umkreis von " + s.radius + " km" : "In deiner Gegend");
                if (s.top > 0) t.append(", davon ").append(s.top).append(s.top == 1 ? " Top-Tipp" : " Top-Tipps")
                        .append(" (Dorf-/Straßen-Flohmarkt)");
                t.append(".");
                if (s.fav > 0) t.append(" Du hast ").append(s.fav).append(" gemerkt.");
            }
            text = t.toString();
            StringBuilder b = new StringBuilder(text);
            for (String line : s.topTitles) b.append("\n★ ").append(line);
            big = b.toString();
        }

        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFF1F6FB2)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(big))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build();
        nm.notify(7, n);
    }

    private static class Summary {
        int total, top, fav, radius;
        List<String> topTitles = new ArrayList<>();
    }

    private static Summary summarize(Context c, JSONObject data) {
        SharedPreferences p = prefs(c);
        double lat = Double.longBitsToDouble(p.getLong("lat", 0));
        double lon = Double.longBitsToDouble(p.getLong("lon", 0));
        double radius = Double.longBitsToDouble(p.getLong("radius", 0));
        boolean hasHome = radius > 0 && (lat != 0 || lon != 0);
        if (!hasHome) {
            // Noch kein eigener Wohnort in der App: Suchgebiet der Webseite verwenden
            JSONObject region = data.optJSONObject("region");
            if (region != null && !region.isNull("home_lat")) {
                lat = region.optDouble("home_lat");
                lon = region.optDouble("home_lon");
                radius = region.optDouble("radius_km", 50);
                hasHome = true;
            }
        }
        Set<String> favs = new HashSet<>();
        try {
            JSONArray a = new JSONArray(p.getString("favs", "[]"));
            for (int i = 0; i < a.length(); i++) favs.add(a.getString(i));
        } catch (Exception ignored) { }

        // Samstag und Sonntag dieses Wochenendes
        Calendar sat = Calendar.getInstance();
        int dow = sat.get(Calendar.DAY_OF_WEEK);
        if (dow == Calendar.SUNDAY) sat.add(Calendar.DAY_OF_MONTH, -1);
        else sat.add(Calendar.DAY_OF_MONTH, (Calendar.SATURDAY - dow + 7) % 7);
        Calendar sun = (Calendar) sat.clone();
        sun.add(Calendar.DAY_OF_MONTH, 1);
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
        String satS = f.format(sat.getTime()), sunS = f.format(sun.getTime());

        Summary s = new Summary();
        s.radius = hasHome ? (int) Math.round(radius) : 0;
        JSONArray events = data.optJSONArray("events");
        if (events == null) return s;
        for (int i = 0; i < events.length(); i++) {
            JSONObject e = events.optJSONObject(i);
            if (e == null || e.optBoolean("is_service") || e.isNull("start_date")) continue;
            String start = e.optString("start_date");
            String end = e.isNull("end_date") ? start : e.optString("end_date", start);
            if (start.compareTo(sunS) > 0 || end.compareTo(satS) < 0) continue;
            if (hasHome) {
                if (e.isNull("lat")) continue;
                if (km(lat, lon, e.optDouble("lat"), e.optDouble("lon")) > radius) continue;
            }
            s.total++;
            if (favs.contains(e.optString("id"))) s.fav++;
            String cat = e.optString("category");
            if ("dorf".equals(cat) || "strasse".equals(cat)) {
                s.top++;
                if (s.topTitles.size() < 4) s.topTitles.add(e.optString("title"));
            }
        }
        return s;
    }

    private static double km(double lat1, double lon1, double lat2, double lon2) {
        double r = Math.PI / 180;
        double a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2)
                + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lon2 - lon1) * r / 2), 2);
        return 12742 * Math.asin(Math.sqrt(a));
    }

    private static JSONObject load() {
        for (String u : DATA_URLS) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(u + "?t=" + System.currentTimeMillis()).openConnection();
                con.setConnectTimeout(10000);
                con.setReadTimeout(20000);
                con.setUseCaches(false);
                if (con.getResponseCode() != 200) continue;
                try (InputStream in = con.getInputStream(); ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                    byte[] b = new byte[16384];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                    return new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {
                // nächste Quelle versuchen
            } finally {
                if (con != null) con.disconnect();
            }
        }
        return null;
    }
}
