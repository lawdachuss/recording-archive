import { userApi } from "./user-api";

const SOUND_KEY = "notif_sound_enabled";
const VIBRATION_KEY = "notif_vibration_enabled";

/**
 * Fetch sound/vibration preferences from the server. Falls back to
 * localStorage if the API call fails (offline, unauthenticated, etc.).
 */
export async function fetchSoundPreferences(): Promise<{
  sound_enabled: boolean;
  vibration_enabled: boolean;
}> {
  try {
    const prefs = await userApi.getSoundPreferences();
    // Sync localStorage with server values
    setLocalSoundEnabled(prefs.sound_enabled);
    setLocalVibrationEnabled(prefs.vibration_enabled);
    return prefs;
  } catch {
    return {
      sound_enabled: getLocalSoundEnabled(),
      vibration_enabled: getLocalVibrationEnabled(),
    };
  }
}

function getLocalSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "false";
  } catch {
    return true;
  }
}

function getLocalVibrationEnabled(): boolean {
  try {
    return localStorage.getItem(VIBRATION_KEY) !== "false";
  } catch {
    return true;
  }
}

function setLocalSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, String(enabled));
  } catch {
    // localStorage not available
  }
}

function setLocalVibrationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(VIBRATION_KEY, String(enabled));
  } catch {
    // localStorage not available
  }
}

/**
 * Save sound/vibration preferences. Writes to localStorage immediately
 * (optimistic) and then syncs to the server.
 */
export async function saveSoundPreferences(opts: {
  sound_enabled?: boolean;
  vibration_enabled?: boolean;
}): Promise<void> {
  // Update localStorage immediately for instant responsiveness
  if (opts.sound_enabled !== undefined) setLocalSoundEnabled(opts.sound_enabled);
  if (opts.vibration_enabled !== undefined) setLocalVibrationEnabled(opts.vibration_enabled);

  // Sync to server (fire-and-forget, swallow errors)
  try {
    await userApi.updateSoundPreferences(opts);
  } catch {
    // Server sync failed — localStorage still has the latest value
  }
}

/**
 * Read current sound preference from localStorage (synchronous, fast).
 * Use this in component render paths where async is not practical.
 */
export function getSoundEnabled(): boolean {
  return getLocalSoundEnabled();
}

/**
 * Read current vibration preference from localStorage (synchronous, fast).
 */
export function getVibrationEnabled(): boolean {
  return getLocalVibrationEnabled();
}
