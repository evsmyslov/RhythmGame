package app.pulsewake.mobile;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Serve packaged assets on a secure origin so ES modules and workers work offline. */
final class GameAssets {
    private static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/index.html";
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private final AssetManager assets;

    GameAssets(AssetManager assets) {
        this.assets = assets;
    }

    static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) &&
            (uri.getPort() == -1 || uri.getPort() == 443);
    }

    WebResourceResponse serve(WebResourceRequest request) {
        if (!isLocal(request.getUrl())) return null;
        String path = request.getUrl().getPath();
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        if ("/".equals(path)) path = "/index.html";
        if (path == null || !path.startsWith("/") || path.contains("\\")) return missing(headers);
        for (String segment : path.substring(1).split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return missing(headers);
        }
        try {
            if (path.endsWith(".mp3")) {
                String range = null;
                for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
                    if ("Range".equalsIgnoreCase(h.getKey())) range = h.getValue();
                }
                return music("game" + path, range, headers);
            }
            String mime = mimeType(path);
            return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null,
                200, "OK", headers, assets.open("game" + path, AssetManager.ACCESS_STREAMING));
        } catch (IOException missingAsset) {
            return missing(headers);
        }
    }

    private static String mimeType(String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "js": return "text/javascript";
            case "html": return "text/html";
            case "css": return "text/css";
            case "woff2": return "font/woff2";
            case "webmanifest": return "application/manifest+json";
            case "json": return "application/json";
            default:
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                return mime == null ? "application/octet-stream" : mime;
        }
    }

    private WebResourceResponse music(String path, String requestedRange, Map<String, String> headers) throws IOException {
        AssetFileDescriptor descriptor = assets.openFd(path);
        long size = descriptor.getLength();
        long start = 0, end = size - 1;
        headers.put("Accept-Ranges", "bytes");
        if (requestedRange != null) {
            Matcher match = RANGE.matcher(requestedRange.trim());
            try {
                if (!match.matches()) throw new NumberFormatException();
                if (match.group(1).isEmpty()) {
                    start = Math.max(0, size - Long.parseLong(match.group(2)));
                } else {
                    start = Long.parseLong(match.group(1));
                    if (!match.group(2).isEmpty()) end = Math.min(end, Long.parseLong(match.group(2)));
                }
                if (end < start) throw new NumberFormatException();
            } catch (NumberFormatException invalid) {
                descriptor.close();
                headers.put("Content-Range", "bytes */" + size);
                return empty(416, "Range Not Satisfiable", headers);
            }
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        }
        long length = end - start + 1;
        headers.put("Content-Length", Long.toString(length));
        InputStream stream = null;
        try {
            stream = descriptor.createInputStream();
            long left = start;
            while (left > 0) {
                long moved = stream.skip(left);
                if (moved == 0) {
                    if (stream.read() < 0) throw new IOException("Audio ended before the requested range");
                    moved = 1;
                }
                left -= moved;
            }
            return new WebResourceResponse("audio/mpeg", null, requestedRange == null ? 200 : 206,
                requestedRange == null ? "OK" : "Partial Content", headers, new RangeStream(stream, length));
        } catch (IOException failed) {
            if (stream != null) stream.close();
            else descriptor.close();
            throw failed;
        }
    }

    private static WebResourceResponse missing(Map<String, String> headers) {
        return empty(404, "Not Found", headers);
    }

    private static WebResourceResponse empty(int code, String reason, Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason, headers, new ByteArrayInputStream(new byte[0]));
    }

    private static final class RangeStream extends FilterInputStream {
        private long remaining;

        RangeStream(InputStream stream, long length) {
            super(stream);
            remaining = length;
        }

        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = in.read();
            if (value >= 0) remaining--;
            return value;
        }

        @Override public int read(byte[] bytes, int offset, int count) throws IOException {
            if (count == 0) return 0;
            if (remaining <= 0) return -1;
            int got = in.read(bytes, offset, (int) Math.min(count, remaining));
            if (got > 0) remaining -= got;
            return got;
        }

        @Override public long skip(long count) throws IOException {
            long skipped = in.skip(Math.max(0, Math.min(count, remaining)));
            remaining -= skipped;
            return skipped;
        }

        @Override public int available() throws IOException {
            return (int) Math.min(remaining, in.available());
        }
    }
}
