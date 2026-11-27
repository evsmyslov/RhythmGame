#!/usr/bin/env bash
# Build from dist/ with Android SDK 36 and a release keystore.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
: "${ANDROID_JAR:=$ANDROID_HOME/platforms/android-36/android.jar}"
: "${BUILD_TOOLS:=$ANDROID_HOME/build-tools/36.0.0}"
: "${PULSEWAKE_KEYSTORE:?Set the release keystore path}"
: "${PULSEWAKE_STORE_PASS:?Set the keystore password}"
target=${1:?Provide an output APK path}
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp"/{res,assets,gen,classes,dex}
cp -R "$root/android/res/." "$tmp/res/"
mkdir -p "$tmp/res/mipmap-xxxhdpi"
cp "$root/dist/assets/icon-192.png" "$tmp/res/mipmap-xxxhdpi/pulsewake.png"
cp -R "$root/dist" "$tmp/assets/game"
"$BUILD_TOOLS/aapt2" compile --dir "$tmp/res" -o "$tmp/resources.zip"
"$BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest "$root/android/AndroidManifest.xml" \
  --java "$tmp/gen" -A "$tmp/assets" -0 mp3 -o "$tmp/base.apk" "$tmp/resources.zip"
mapfile -t sources < <(find "$root/android/src" "$tmp/gen" -name '*.java')
if [[ -n ${ECJ_JAR:-} ]]; then
  java -jar "$ECJ_JAR" -proc:none -nowarn -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$tmp/classes" "${sources[@]}"
else
  javac --release 8 -classpath "$ANDROID_JAR" -d "$tmp/classes" "${sources[@]}"
fi
(cd "$tmp/classes" && zip -q -r "$tmp/classes.jar" .)
"$BUILD_TOOLS/d8" --release --min-api 29 --lib "$ANDROID_JAR" --output "$tmp/dex" "$tmp/classes.jar"
(cd "$tmp/dex" && zip -q -0 "$tmp/base.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$tmp/base.apk" "$tmp/aligned.apk"
"$BUILD_TOOLS/apksigner" sign --ks "$PULSEWAKE_KEYSTORE" --ks-key-alias pulsewake --ks-pass env:PULSEWAKE_STORE_PASS --out "$target" "$tmp/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$target"
