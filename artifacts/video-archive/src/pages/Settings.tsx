import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserProfile } from "@/lib/user-api";
import { supabase } from "@/lib/supabase";
import {
  Settings as SettingsIcon, User, Lock, Save, AlertCircle, CheckCircle2,
} from "lucide-react";

export default function Settings() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPw, setCurrentPw] = useState("");
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
  }, [user]);

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
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
    } else {
      setPwMsg({ ok: true, text: "Password updated successfully." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    }
    setTimeout(() => setPwMsg(null), 3000);
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
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/40">
            <User className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Profile</h2>
          </div>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={user.email ?? ""}
                disabled
                className="w-full h-10 bg-secondary/20 border border-border/40 rounded-sm px-3 text-sm text-muted-foreground/60 cursor-not-allowed"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                placeholder="How others see you"
                className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Avatar URL
              </label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="A little about you (optional)"
                className="w-full bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 py-2 text-sm outline-none transition-all resize-none placeholder:text-muted-foreground/40"
              />
            </div>

            {saveMsg && (
              <div
                className={`flex items-center gap-2 p-3 border rounded-sm text-xs ${
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
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>
        </section>

        {/* Password */}
        <section>
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/40">
            <Lock className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Change Password</h2>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Password
              </label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
                className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
            </div>

            {pwMsg && (
              <div
                className={`flex items-center gap-2 p-3 border rounded-sm text-xs ${
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
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm disabled:opacity-60"
            >
              <Lock className="w-3.5 h-3.5" />
              {pwSaving ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </Layout>
  );
}
