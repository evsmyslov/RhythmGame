# Pulsewake

A four-lane rhythm game for Android and the web. The five built-in maps range from Glass Ferry at 76 BPM to Ion Storm at 196 BPM. Audio files and downloadable media use onset analysis. YouTube uses the embedded player’s clock with entered or tapped tempo. Its video becomes a blurred backdrop during play. SoundCloud can import full recordings published in a creator’s feed. Spotify and Apple Music can offer previews, identified before play or MP3 export. Internet Archive recordings, direct media links and local files also support analysis and export when the audio is readable.

Pause to resume, restart or change settings. Track, menu and hit volume, effects quality, calibration, vibration and language are saved on the device. The game includes English and Russian. Built-in maps work offline in the APK. The Records tab shows a public leaderboard for each built-in map. Players can submit their local best under a nickname.

The player library lives on the device. Played files and readable audio links are stored for offline replay. Streaming links retain their tempo, beat offset and difficulty. The library also includes played built-in maps and the demo. Removing an entry leaves personal scores intact.

Runs start with 100 health. A missed note or broken slide costs 12.5, a good hit restores 3 and a perfect hit restores 5. At zero health the run ends, and only completed runs can set a record. The library lets players select a difficulty on every replay. Alternate difficulties of built-in tracks use generated charts and separate local scores. The published map leaderboard uses the authored difficulty.

## Web

Serve `dist/` with a static HTTP server. GitHub Pages serves the contents on `gh-pages`.

## Android

Version 1.3.0 updates the 1.1 and 1.2 releases in place, uses `app.pulsewake.mobile` and can be installed alongside 1.0.3 (`app.pulsewake.game`). Requires Android 10 or later. To build, install a JDK, Android SDK Platform 36 and Build Tools 36.0.0. Set `ANDROID_HOME`, `PULSEWAKE_KEYSTORE` (keystore containing the alias `pulsewake`) and `PULSEWAKE_STORE_PASS`, then run:

```sh
bash android/build.sh Pulsewake-1.3.0.apk
```

## Scores

`leaderboard/worker/index.js` serves the public ranking. Its D1 schema is in `leaderboard/drizzle/`. Only a player’s nickname and best score appear in the top 20. The game keeps the player credential on the device. The server stores its hash.

Revised maps have separate ranking IDs. The public music metadata endpoint is implemented in `leaderboard/worker/media.js`. MP3 export uses the bundled lamejs encoder in a Web Worker and the Android document picker.
