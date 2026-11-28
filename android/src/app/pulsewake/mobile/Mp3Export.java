package app.pulsewake.mobile;

import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Only the packaged top-level page receives this port. Embedded players receive no Android API. */
final class Mp3Export {
    private static final Uri ORIGIN = Uri.parse("https://appassets.androidplatform.net");
    private static final long MAX_SIZE = 40L * 1024 * 1024;
    private final MainActivity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final HandlerThread thread = new HandlerThread("Pulsewake-MP3");
    private final Handler io;
    private final WebMessagePort port;
    private final WebMessagePort pagePort;
    private volatile boolean closed;
    // Only the IO thread touches the staged bytes and active request.
    private String transfer;
    private String filename;
    private long expected, received;
    private File file;
    private FileOutputStream output;

    Mp3Export(MainActivity activity, WebView view) {
        this.activity = activity;
        thread.start();
        io = new Handler(thread.getLooper());
        WebMessagePort[] channel = view.createWebMessageChannel();
        port = channel[0];
        pagePort = channel[1];
        port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort source, WebMessage message) {
                if (!closed) receive(message.getData());
            }
        }, io);
        String ticket = UUID.randomUUID().toString();
        String install = "(() => { const receive = e => { if(e.data !== '" + ticket +
            "' || e.ports.length !== 1) return; window.removeEventListener('message',receive); " +
            "window.pulsewakeFilePort=e.ports[0]; }; window.addEventListener('message',receive); })()";
        view.evaluateJavascript(install, ignored -> {
            if (!closed && trustedPage(view.getUrl())) {
                view.postWebMessage(new WebMessage(ticket, new WebMessagePort[] {pagePort}), ORIGIN);
            }
        });
    }

    static boolean trustedPage(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return GameAssets.isLocal(uri) && ("/index.html".equals(uri.getPath()) || "/".equals(uri.getPath()));
    }

    private void receive(String text) {
        if (text == null || text.length() > 70000) return;
        String id = "";
        try {
            JSONObject msg = new JSONObject(text);
            id = msg.getString("id");
            if (id.length() > 64 || id.isEmpty()) return;
            String type = msg.getString("type");
            if ("begin".equals(type)) {
                if (transfer != null) { respond(id, "error"); return; }
                long size = msg.getLong("size");
                if (size < 4 || size > MAX_SIZE) { respond(id, "error"); return; }
                transfer = id;
                expected = size;
                filename = msg.getString("filename");
                filename = filename.replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|]", "_");
                if (filename.length() > 120) filename = filename.substring(0, 120);
                if (!filename.endsWith(".mp3")) filename += ".mp3";
                file = File.createTempFile("pulsewake-mp3-", ".tmp", activity.getCacheDir());
                output = new FileOutputStream(file);
            } else {
                if (!id.equals(transfer)) return;
                switch (type) {
                    case "chunk":
                        byte[] bytes = Base64.decode(msg.getString("bytes"), Base64.NO_WRAP);
                        if (output == null || bytes.length == 0 || bytes.length > 49152 ||
                            received + bytes.length > expected) throw new IOException("Invalid block");
                        if (received == 0 && !isMp3(bytes)) throw new IOException("Invalid MP3");
                        output.write(bytes);
                        received += bytes.length;
                        break;
                    case "save":
                        if (output == null || received != expected) throw new IOException("Incomplete MP3");
                        output.close();
                        output = null;
                        String requestId = id;
                        String displayName = filename;
                        main.post(() -> {
                            if (!closed) activity.chooseExportDocument(this, requestId, displayName);
                        });
                        return;
                    case "cancel":
                        discard();
                        respond(id, "cancelled");
                        return;
                    default:
                        throw new IOException("Unknown message");
                }
            }
            respond(id, "ok");
        } catch (IOException | JSONException | IllegalArgumentException failure) {
            if (id.equals(transfer)) discard();
            respond(id, "error");
        }
    }

    private static boolean isMp3(byte[] bytes) {
        return bytes.length >= 3 && ((bytes[0] == 'I' && bytes[1] == 'D' && bytes[2] == '3') ||
            ((bytes[0] & 0xff) == 0xff && (bytes[1] & 0xe0) == 0xe0));
    }

    void documentPicked(String id, Uri uri, boolean unavailable) {
        if (closed) return;
        io.post(() -> {
            if (!id.equals(transfer)) return;
            String result = "cancelled";
            if (unavailable) result = "error";
            else if (uri != null && "content".equals(uri.getScheme())) {
                try (FileInputStream input = new FileInputStream(file);
                     OutputStream destination = activity.getContentResolver().openOutputStream(uri, "wt")) {
                    if (destination == null) throw new IOException("Missing destination");
                    byte[] bytes = new byte[32768];
                    int n;
                    while ((n = input.read(bytes)) >= 0) destination.write(bytes, 0, n);
                    destination.flush();
                    result = "ok";
                } catch (IOException | RuntimeException failed) { result = "error"; }
            }
            discard();
            respond(id, result);
        });
    }

    private void respond(String id, String status) {
        final String json = "{\"id\":" + JSONObject.quote(id) + ",\"status\":" + JSONObject.quote(status) + "}";
        main.post(() -> { if (!closed) port.postMessage(new WebMessage(json)); });
    }

    private void discard() {
        if (output != null) try { output.close(); } catch (IOException ignored) {}
        if (file != null) file.delete();
        file = null;
        output = null;
        transfer = null;
        received = 0;
    }

    void close() {
        closed = true;
        port.close();
        io.post(this::discard);
        thread.quitSafely();
    }
}
