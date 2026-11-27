# Pulsewake

A four-lane rhythm game for Android and the web. The five built-in maps range from Glass Ferry at 76 BPM to Ion Storm at 196 BPM. Audio files and downloadable media use onset analysis. YouTube, Spotify and SoundCloud use the provider’s player and a tempo you can enter or tap. Playback length and availability depend on the provider.

The game includes English and Russian. Built-in maps work offline in the APK. The Records tab shows a public leaderboard for each built-in map. Players can submit their local best under a nickname.

## Web

Serve `dist/` with a static HTTP server. GitHub Pages serves the contents on `gh-pages`.

## Android

The 1.1 release uses `app.pulsewake.mobile` and can be installed alongside 1.0.3 (`app.pulsewake.game`). Requires Android 10 or later. To build, install a JDK, Android SDK Platform 36 and Build Tools 36.0.0. Set `ANDROID_HOME`, `PULSEWAKE_KEYSTORE` (keystore containing the alias `pulsewake`) and `PULSEWAKE_STORE_PASS`, then run:

```sh
bash android/build.sh Pulsewake-1.1.0.apk
```

## Scores

`leaderboard/worker/index.js` serves the public ranking. Its D1 schema is in `leaderboard/drizzle/`. Only a player’s nickname and best score appear in the top 20. The game keeps the player credential on the device. The server stores its hash.
