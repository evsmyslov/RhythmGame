// Resolve share links without substituting a different recording. "preview" is always a clip.
const endpoint = "https://pulsewake-scores.royalhero8192.chatgpt.site/v1/media";

export function providerReference(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "archive.org" && parts[0] === "details" && /^[\w.-]+$/.test(parts[1] || "")) {
    return { provider: "Internet Archive", id: parts[1], url: url.href };
  }
  if (host === "music.apple.com" && /^[a-z]{2}$/i.test(parts[0] || "")) {
    const id = parts[1] === "album" ? url.searchParams.get("i") : parts[1] === "song" ? parts.at(-1) : null;
    if (/^\d+$/.test(id || "")) return { provider: "Apple Music", id, url: url.href, country: parts[0] };
  }
  return null;
}

export async function resolveProvider(reference, signal) {
  const fallback = { reference, status: "embed-only", title: "", artist: "" };
  if (!reference) return null;
  try {
    if (reference.provider === "Internet Archive") return await archiveTrack(reference, signal);
    if (reference.provider === "Apple Music") return await appleTrack(reference, signal);
    if (!["Spotify", "SoundCloud"].includes(reference.provider)) return fallback;
    const publicLink = new URL(reference.url);
    if (reference.provider === "SoundCloud" && (/\/s-[\w-]+\/?$/.test(publicLink.pathname) || publicLink.searchParams.has("secret_token"))) {
      return { ...fallback, reason: "private" };
    }
    publicLink.search = "";
    publicLink.hash = "";
    const url = new URL(endpoint);
    url.searchParams.set("url", publicLink.href);
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok) return { ...fallback, reason: "network" };
    const data = await response.json();
    if (!["downloadable", "preview", "embed-only", "blocked"].includes(data.status)) return fallback;
    return { ...data, reference: { ...reference, url: data.canonicalUrl || reference.url, id: data.id || reference.id } };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return { ...fallback, status: ["Apple Music", "Internet Archive"].includes(reference.provider) ? "blocked" : "embed-only", reason: "network" };
  }
}

async function archiveTrack(reference, signal) {
  const result = { reference, title: "", artist: "", status: "blocked" };
  const response = await fetch("https://archive.org/metadata/" + encodeURIComponent(reference.id), { signal, credentials: "omit" });
  if (!response.ok) return { ...result, reason: response.status === 404 ? "unavailable" : "network" };
  const { metadata, files = [], is_dark } = await response.json();
  if (!metadata || String(is_dark) === "true" || String(metadata["access-restricted-item"]) === "true") return { ...result, reason: "restricted" };
  result.title = String(metadata.title || "");
  result.artist = [metadata.creator || ""].flat().join(", ");
  const requested = new URL(reference.url).pathname.split("/").slice(3).map(decodeURIComponent).join("/");
  const byName = new Map(files.map(file => [file.name, file]));
  const groups = new Map();
  for (const file of files) {
    if (String(file.private) === "true" || file.name.startsWith("/") || file.name.split("/").includes("..")) continue;
    const ext = /\.(mp3|m4a|ogg|opus|wav|flac)$/i.exec(file.name)?.[1]?.toLowerCase();
    if (!ext || Number(file.size) > 60 * 1024 * 1024) continue;
    if (requested && requested !== file.name) continue;
    let root = file;
    for (let i = 0; i < 4 && root.original && byName.has(root.original); i++) root = byName.get(root.original);
    const key = root.name;
    if (!groups.has(key) || ext === "mp3") groups.set(key, file);
  }
  const media = file => "https://archive.org/download/" + encodeURIComponent(reference.id) + "/" + file.name.split("/").map(encodeURIComponent).join("/");
  if (groups.size > 1) return { ...result, reason: "choose-track", choices: Array.from(groups.values(), file => ({ title: file.title || file.name, url: media(file) })) };
  if (!groups.size) return { ...result, reason: "unavailable" };
  const [file] = groups.values();
  return { ...result, status: "downloadable", title: file.title || metadata.title || file.name, mediaUrl: media(file) };
}

async function appleTrack(reference, signal) {
  const result = { reference, title: "", artist: "", status: "blocked" };
  const url = new URL("https://itunes.apple.com/lookup");
  url.search = new URLSearchParams({ id: reference.id, country: reference.country }).toString();
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) return { ...result, reason: "network" };
  const { results = [] } = await response.json();
  const track = results.find(item => String(item.trackId) === reference.id && item.kind === "song");
  if (!track) return { ...result, reason: "unavailable" };
  const common = { ...result, title: track.trackName || "", artist: track.artistName || "" };
  return track.previewUrl?.startsWith("https://") ? { ...common, status: "preview", mediaUrl: track.previewUrl } : { ...common, reason: "restricted" };
}
