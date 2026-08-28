import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserProfile } from "@/lib/user-api";
import { getSoundEnabled, getVibrationEnabled, fetchSoundPreferences, saveSoundPreferences } from "@/lib/sound-prefs";
import { getSupabase } from "@/lib/supabase";
import { useCacheProfiler, type CacheProfile } from "@/hooks/use-cache-profiler";
import { clearImageCache, getCacheStats } from "@/lib/image-cache";
import {
  Settings as SettingsIcon, User, Lock, Save, AlertCircle, CheckCircle2,
  Bell, BellOff, Mail, Volume2, Smartphone, Database, Trash2, RefreshCw,
} from "lucide-react";

const NOTIF_LABELS: Record<string, { label: string; description: string }> = {
  request_submitted: {
    label: "Request Submitted",
    description: "When you submit a new performer request",
  },
  request_status: {
    label: "Request Status Changes",
    description: "When your request is approved, rejected, or completed",
  },
  recording_available: {
    label: "Recording Available",
    description: "When a new recording matches one of your requests",
  },
};

export default function Settings() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [notifPrefs, setNotifPrefs] = useState<{ type: string; enabled: boolean; email_enabled: boolean }[]>([]);
  const [notifPrefsLoading, setNotifPrefsLoading] = useState(true);
  const [notifPrefsSaving, setNotifPrefsSaving] = useState(false);
  const [notifPrefsMsg, setNotifPrefsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [vibrateOn, setVibrateOn] = useState(true);

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  useEffect(() => {
    if (!user) return;
    userApi.getProfile().then((p) => {
      setProfile(p);
      setDisplayName(p.display_name ?? "");
      setBio(p.bio ?? "");
      setAvatarUrl(p.avatar_url ?? "");
    }).catch(() => {});

    userApi.getNotificationPreferences().then((prefs) => {
      setNotifPrefs(prefs.map((p) => ({ type: p.type, enabled: p.enabled, email_enabled: p.email_enabled })));
      setNotifPrefsLoading(false);
    }).catch(() => {
      setNotifPrefsLoading(false);
    });

    fetchSoundPreferences().then((prefs) => {
      setSoundOn(prefs.sound_enabled);
      setVibrateOn(prefs.vibration_enabled);
    });
  }, [user, loading]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await userApi.updateProfile({
        display_name: displayName || undefined,
        bio: bio || undefined,
        avatar_url: avatarUrl || undefined,
      });
      setProfile(updated);
      setSaveMsg({ ok: true, text: "Profile saved." });
    } catch {
      setSaveMsg({ ok: false, text: "Failed to save profile." });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    if (newPw.length < 6) {
      setPwMsg({ ok: false, text: "Password must be at least 6 characters." });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
    } else {
      setPwMsg({ ok: true, text: "Password updated successfully." });
      setNewPw("");
      setConfirmPw("");
    }
    setTimeout(() => setPwMsg(null), 3000);
  };

  // Cache profiling
  const cacheStats = useCacheProfiler(2000);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [cacheSize, setCacheSize] = useState<{ memoryEntries: number; memoryBytes: number; idbEntries: number; idbBytes: number } | null>(null);

  useEffect(() => {
    if (!cacheStats) return;
    getCacheStats().then(setCacheSize);
  }, [cacheStats?.totalLookups]); // re-fetch when lookup count changes

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await clearImageCache();
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 3000);
    } finally {
      setClearingCache(false);
    }
  };

  if (loading) return null;
  if (!user) return null;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-2xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <SettingsIcon className="w-3.5 h-3.5 text-primary" />
            Settings
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Account Settings</h1>
        </div>

        {/* Profile */}
        <section className="mb-8 border border-border/40 rounded-xl p-5 sm:p-6 bg-card">
          <div className="flex items-center gap-2 mb-5 pb-3 border-b border-border/30">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Profile</h2>
          </div>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={user.email ?? ""}
                disabled
                className="w-full h-10 bg-secondary border border-border/40 rounded-lg px-3 text-sm text-muted-foreground/60 cursor-not-allowed"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                placeholder="How others see you"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Avatar URL
              </label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="A little about you (optional)"
                className="w-full bg-secondary border border-border/60 focus:border-primary/50 rounded-lg px-3 py-2 text-sm outline-none transition-all resize-none placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
              />
            </div>

            {saveMsg && (
              <div
                className={`flex items-center gap-2 p-3 border rounded-lg text-xs ${
                  saveMsg.ok
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
              >
                {saveMsg.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                {saveMsg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>
        </section>

        {/* Notification Preferences */}
        <section className="mb-8 border border-border/40 rounded-xl p-5 sm:p-6 bg-card">
          <div className="flex items-center gap-2 mb-5 pb-3 border-b border-border/30">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Notifications</h2>
          </div>

          {notifPrefsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-secondary/30 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {/* Master toggle */}
              <label className="flex items-center justify-between px-3 py-3 rounded-lg bg-secondary/30 hover:bg-secondary/40 transition-colors cursor-pointer">
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    notifPrefs.every((p) => p.enabled)
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-muted-foreground/50"
                  }`}>
                    {notifPrefs.every((p) => p.enabled) ? (
                      <Bell className="w-4 h-4" />
                    ) : (
                      <BellOff className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      All notifications
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      {notifPrefs.every((p) => p.enabled)
                        ? "All notification types are enabled"
                        : notifPrefs.some((p) => p.enabled)
                          ? "Some notification types are disabled"
                          : "All notification types are disabled"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifPrefs.every((p) => p.enabled)}
                  onClick={() => {
                    const allEnabled = notifPrefs.every((p) => p.enabled);
                    // If turning all off, show confirmation
                    if (allEnabled) {
                      setShowDisableConfirm(true);
                      return;
                    }
                    // Turning all on — proceed directly
                    const updated = notifPrefs.map((p) => ({ ...p, enabled: true }));
                    setNotifPrefs(updated);
                    setNotifPrefsSaving(true);
                    setNotifPrefsMsg(null);
                    userApi.updateNotificationPreferences(updated).then(() => {
                      setNotifPrefsSaving(false);
                      setNotifPrefsMsg({ ok: true, text: "Notification preferences saved." });
                    }).catch(() => {
                      setNotifPrefsSaving(false);
                      setNotifPrefsMsg({ ok: false, text: "Failed to save preferences." });
                      userApi.getNotificationPreferences().then(setNotifPrefs);
                    });
                    setTimeout(() => setNotifPrefsMsg(null), 3000);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    notifPrefs.every((p) => p.enabled)
                      ? "bg-primary"
                      : "bg-border hover:bg-border/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ${
                      notifPrefs.every((p) => p.enabled) ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>

              {/* Divider */}
              <div className="h-px bg-border/30 mx-3" />

              {/* Column header row */}
              <div className="flex items-center px-3 py-1.5 text-[11px] text-muted-foreground/50 uppercase tracking-wider font-medium">
                <div className="min-w-0 flex-1" />
                <div className="flex items-center gap-6 shrink-0">
                  <span className="w-9 text-center">In-app</span>
                  <span className="w-9 text-center">Email</span>
                </div>
              </div>

              {notifPrefs.map((pref) => (
                <div
                  key={pref.type}
                  className="flex items-center px-3 py-3 rounded-lg hover:bg-secondary/30 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="text-sm font-medium text-foreground">
                      {NOTIF_LABELS[pref.type]?.label ?? pref.type}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      {NOTIF_LABELS[pref.type]?.description ?? ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    {/* In-app toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={pref.enabled}
                      aria-label={`${NOTIF_LABELS[pref.type]?.label ?? pref.type} in-app notifications`}
                      onClick={() => {
                        const updated = notifPrefs.map((p) =>
                          p.type === pref.type ? { ...p, enabled: !p.enabled } : p
                        );
                        setNotifPrefs(updated);
                        setNotifPrefsSaving(true);
                        setNotifPrefsMsg(null);
                        userApi.updateNotificationPreferences(updated).then(() => {
                          setNotifPrefsSaving(false);
                          setNotifPrefsMsg({ ok: true, text: "Notification preferences saved." });
                        }).catch(() => {
                          setNotifPrefsSaving(false);
                          setNotifPrefsMsg({ ok: false, text: "Failed to save preferences." });
                          // Revert on failure
                          userApi.getNotificationPreferences().then((prefs) =>
                            setNotifPrefs(prefs.map((p) => ({ type: p.type, enabled: p.enabled, email_enabled: p.email_enabled })))
                          );
                        });
                        setTimeout(() => setNotifPrefsMsg(null), 3000);
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        pref.enabled
                          ? "bg-primary"
                          : "bg-border hover:bg-border/80"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ${
                          pref.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>

                    {/* Email toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={pref.email_enabled}
                      aria-label={`${NOTIF_LABELS[pref.type]?.label ?? pref.type} email notifications`}
                      onClick={() => {
                        const updated = notifPrefs.map((p) =>
                          p.type === pref.type ? { ...p, email_enabled: !p.email_enabled } : p
                        );
                        setNotifPrefs(updated);
                        setNotifPrefsSaving(true);
                        setNotifPrefsMsg(null);
                        userApi.updateNotificationPreferences(updated).then(() => {
                          setNotifPrefsSaving(false);
                          setNotifPrefsMsg({ ok: true, text: "Notification preferences saved." });
                        }).catch(() => {
                          setNotifPrefsSaving(false);
                          setNotifPrefsMsg({ ok: false, text: "Failed to save preferences." });
                          // Revert on failure
                          userApi.getNotificationPreferences().then((prefs) =>
                            setNotifPrefs(prefs.map((p) => ({ type: p.type, enabled: p.enabled, email_enabled: p.email_enabled })))
                          );
                        });
                        setTimeout(() => setNotifPrefsMsg(null), 3000);
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        pref.email_enabled
                          ? "bg-primary"
                          : "bg-border hover:bg-border/80"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ${
                          pref.email_enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notifPrefsMsg && (
            <div
              className={`mt-3 flex items-center gap-2 p-3 border rounded-lg text-xs ${
                notifPrefsMsg.ok
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}
            >
              {notifPrefsMsg.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              {notifPrefsMsg.text}
            </div>
          )}

          {/* Sound & Vibration toggles */}
          <div className="mt-5 pt-4 border-t border-border/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-3">
              Sound &amp; Vibration
            </p>
            <div className="space-y-1">
              {/* Sound toggle */}
              <label className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer">
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${soundOn ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground/50"}`}>
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Notification Sound</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">Play a chime when a new notification arrives</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundOn}
                  onClick={() => {
                    const next = !soundOn;
                    setSoundOn(next);
                    saveSoundPreferences({ sound_enabled: next });
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    soundOn ? "bg-primary" : "bg-border hover:bg-border/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ${
                      soundOn ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>

              {/* Vibration toggle */}
              <label className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer">
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${vibrateOn ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground/50"}`}>
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Vibration</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">Vibrate on mobile when a notification arrives</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={vibrateOn}
                  onClick={() => {
                    const next = !vibrateOn;
                    setVibrateOn(next);
                    saveSoundPreferences({ vibration_enabled: next });
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    vibrateOn ? "bg-primary" : "bg-border hover:bg-border/80"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ${
                      vibrateOn ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
            </div>
          </div>

          {notifPrefsSaving && (
            <p className="mt-2 text-[11px] text-muted-foreground/50 flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Email notifications require an email service to be configured before they are sent.
            </p>
          )}

          {/* Confirmation dialog for disabling all notifications */}
          {showDisableConfirm && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => setShowDisableConfirm(false)}
            >
              <div
                className="w-full max-w-sm mx-4 bg-card border border-border/40 rounded-xl p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center">
                    <BellOff className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      Disable all notifications?
                    </h3>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      You won't receive any in-app notifications until you re-enable them.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowDisableConfirm(false)}
                    className="h-9 px-4 text-xs font-medium border border-border/40 rounded-lg text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisableConfirm(false);
                      const updated = notifPrefs.map((p) => ({ ...p, enabled: false }));
                      setNotifPrefs(updated);
                      setNotifPrefsSaving(true);
                      setNotifPrefsMsg(null);
                      userApi.updateNotificationPreferences(updated).then(() => {
                        setNotifPrefsSaving(false);
                        setNotifPrefsMsg({ ok: true, text: "All notifications disabled." });
                      }).catch(() => {
                        setNotifPrefsSaving(false);
                        setNotifPrefsMsg({ ok: false, text: "Failed to save preferences." });
                        userApi.getNotificationPreferences().then(setNotifPrefs);
                      });
                      setTimeout(() => setNotifPrefsMsg(null), 3000);
                    }}
                    className="h-9 px-4 text-xs font-semibold bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Yes, disable all
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Password */}
        <section className="border border-border/40 rounded-xl p-5 sm:p-6 bg-card">
          <div className="flex items-center gap-2 mb-5 pb-3 border-b border-border/30">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Change Password</h2>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Password
              </label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
              />
            </div>

            {pwMsg && (
              <div
                className={`flex items-center gap-2 p-3 border rounded-lg text-xs ${
                  pwMsg.ok
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
              >
                {pwMsg.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                {pwMsg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={pwSaving || !newPw}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg disabled:opacity-60"
            >
              <Lock className="w-3.5 h-3.5" />
              {pwSaving ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>

        {/* Cache Performance */}
        <section className="border border-border/40 rounded-xl p-5 sm:p-6 bg-card">
          <div className="flex items-center gap-2 mb-5 pb-3 border-b border-border/30">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Database className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Cache Performance</h2>
          </div>

          {cacheStats ? (
            <div className="space-y-4">
              {/* Hit Rate Gauges */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Memory"
                  value={`${cacheStats.memoryHitRate.toFixed(1)}%`}
                  detail={`${cacheStats.memoryHits} hits`}
                  color="text-green-400"
                />
                <StatCard
                  label="IDB"
                  value={`${cacheStats.idbHitRate.toFixed(1)}%`}
                  detail={`${cacheStats.idbHits} hits`}
                  color="text-blue-400"
                />
                <StatCard
                  label="Overall"
                  value={`${cacheStats.overallHitRate.toFixed(1)}%`}
                  detail={`${cacheStats.totalLookups} total`}
                  color="text-primary"
                />
              </div>

              {/* Timing */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="IDB Lookup"
                  value={cacheStats.idbLookupCount > 0 ? `${(cacheStats.idbLookupMs / cacheStats.idbLookupCount).toFixed(1)}ms` : "—"}
                  detail={`${cacheStats.idbLookupCount} lookups`}
                  color="text-yellow-400"
                />
                <StatCard
                  label="Fetch"
                  value={cacheStats.fetchCount > 0 ? `${(cacheStats.fetchMs / cacheStats.fetchCount).toFixed(0)}ms` : "—"}
                  detail={`${cacheStats.fetchCount} fetches, ${cacheStats.deduped} deduped`}
                  color="text-orange-400"
                />
              </div>

              {/* Cache Size */}
              {cacheSize && (
                <div className="bg-secondary/30 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-2">Storage</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground/60">Memory LRU</p>
                      <p className="text-sm font-bold text-green-400">{cacheSize.memoryEntries} entries</p>
                      <p className="text-[10px] text-muted-foreground/40">~{(cacheSize.memoryBytes / 1024 / 1024).toFixed(1)} MB / 50 MB cap</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground/60">IndexedDB</p>
                      <p className="text-sm font-bold text-blue-400">{cacheSize.idbEntries} entries</p>
                      <p className="text-[10px] text-muted-foreground/40">{(cacheSize.idbBytes / 1024 / 1024).toFixed(1)} MB / 200 MB cap</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Category Breakdown */}
              {Object.keys(cacheStats.byCategory).length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider font-medium mb-2">
                    By Category
                  </p>
                  <div className="space-y-1.5">
                    {Object.entries(cacheStats.byCategory).map(([cat, stats]: [string, { hits: number; misses: number; fetches: number }]) => {
                      const total = stats.hits + stats.misses;
                      const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;
                      return (
                        <div key={cat} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/30">
                          <span className="text-xs font-medium capitalize w-20 shrink-0">{cat}</span>
                          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full transition-all duration-500"
                              style={{ width: `${hitRate}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground/60 w-16 text-right">
                            {hitRate.toFixed(0)}% ({stats.hits}/{total})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live indicator + Clear button */}
              <div className="flex items-center justify-between pt-2 border-t border-border/20">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[11px] text-muted-foreground/50">
                    Live • {Math.round((Date.now() - cacheStats.startTime) / 1000)}s elapsed
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium border border-border/40 rounded-md text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    disabled={clearingCache}
                    className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium border border-destructive/30 rounded-md text-destructive/80 hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-60"
                  >
                    <Trash2 className="w-3 h-3" />
                    {clearingCache ? "Clearing…" : "Clear Cache"}
                  </button>
                </div>
              </div>

              {cacheCleared && (
                <p className="text-[11px] text-green-400 text-center">Cache cleared successfully.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-secondary/30 rounded-lg animate-pulse" />
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <div className="bg-secondary/30 rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground/40 mt-0.5">{detail}</p>
    </div>
  );
}
