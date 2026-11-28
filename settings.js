const defaults = { music: 85, hits: 75, lobby: 45, vibration: false, effects: "auto" };
const effectsModes = ["auto", "low", "full"];
export const preferences = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem("pulsewake-settings") || "{}");
  for (const key of ["music", "hits", "lobby"]) {
    if (Number.isFinite(saved?.[key])) preferences[key] = Math.max(0, Math.min(100, Math.round(saved[key])));
  }
  preferences.vibration = saved?.vibration === true;
  if (effectsModes.includes(saved?.effects)) preferences.effects = saved.effects;
} catch { /* Device preferences are optional. */ }

export function bindSettings(game, lobbyAudio) {
  const dialog = document.getElementById("settings-dialog");
  function apply() {
    lobbyAudio.volume = preferences.lobby / 100;
    game.applyPreferences();
  }
  for (const control of dialog.querySelectorAll("[data-pref]")) {
    const key = control.dataset.pref;
    const range = control.type === "range";
    const output = range && control.parentElement.querySelector("output");
    if (control.type === "checkbox") control.checked = preferences[key];
    else control.value = preferences[key];
    if (range) output.textContent = control.value + "%";
    control.addEventListener(range ? "input" : "change", () => {
      preferences[key] = range ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
      if (range) output.textContent = control.value + "%";
      apply();
      try { localStorage.setItem("pulsewake-settings", JSON.stringify(preferences)); } catch { /* Remains active for this session. */ }
    });
  }
  document.getElementById("vibration-row").hidden = typeof navigator.vibrate !== "function";
  const open = () => dialog.showModal();
  document.getElementById("settings-button").onclick = open;
  document.getElementById("pause-settings").onclick = open;
  apply();
}
