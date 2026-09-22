import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import { Crown, RefreshCw, Server, BadgeCheck, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/formatters";

interface AdminPremiumUser {
  user_id: string;
  premium_expires_at: string | null;
  ads_seen_date: string | null;
  ads_seen_count: number;
  last_rewarded_at: string | null;
  is_premium: boolean;
  display_name: string | null;
  username: string | null;
  email: string | null;
}

interface Settings {
  ads_enabled: boolean;
  ads_target: number;
  reward_cooldown_s: number;
  grace_minutes: number;
  price_usd: number;
}

export default function AdminPremium() {
  const { session } = useAuth();
  const [list, setList] = useState<AdminPremiumUser[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [grantEmail, setGrantEmail] = useState("");
  const [grantDays, setGrantDays] = useState("30");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMsg, setGrantMsg] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [session]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const [listRes, cfgRes] = await Promise.all([
        fetch(resolveApiPath("/api/admin/premium/list"), { headers: headers() }),
        fetch(resolveApiPath("/api/premium/config"), { headers: headers() }),
      ]);
      const listData = (await listRes.json()) as AdminPremiumUser[];
      const cfgData = (await cfgRes.json()) as Settings;
      setList(Array.isArray(listData) ? listData : []);
      setSettings(cfgData);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load premium data");
    } finally {
      setLoading(false);
    }
  }, [session, headers]);

  useEffect(() => {
    if (session?.access_token) load();
  }, [session, load]);

  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState(false);

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings || !session?.access_token) return;
    setSettingsBusy(true);
    try {
      const res = await fetch(resolveApiPath("/api/admin/premium/settings"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      setSettings((await res.json()) as Settings);
      setSettingsSavedMsg(true);
      setTimeout(() => setSettingsSavedMsg(false), 2500);
    } finally {
      setSettingsBusy(false);
    }
  };

  const grant = async () => {
    if (!grantEmail.trim() || grantBusy) return;
    setGrantBusy(true);
    setGrantMsg(null);
    try {
      const res = await fetch(resolveApiPath("/api/admin/premium/grant"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email: grantEmail.trim(), days: Number(grantDays) || 30 }),
      });
      const data = (await res.json()) as { error?: string; premium_until?: string };
      if (!res.ok || !data.premium_until) {
        setGrantMsg(`Grant failed: ${data.error ?? "HTTP " + res.status}`);
        return;
      }
      setGrantMsg(`Granted — premium until ${new Date(data.premium_until).toLocaleDateString()}`);
      setGrantEmail("");
      void load();
    } finally {
      setGrantBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Crown className="w-4 h-4 text-primary" /> Premium &amp; Ads
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Manage ad-free subscribers, the ad earn target, and the ads kill-switch.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Runtime settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-primary" /> Runtime settings
            </CardTitle>
            <CardDescription>Applied instantly — no redeploy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm">Ads enabled</div>
                    <div className="text-xs text-muted-foreground">Master kill-switch for all ad slots.</div>
                  </div>
                  <Switch
                    checked={settings.ads_enabled}
                    onCheckedChange={(v) => saveSettings({ ads_enabled: v })}
                  />
                </div>

                <label className="block">
                  <span className="text-sm">Ads per premium day</span>
                  <Input
                    type="number"
                    min={1}
                    value={settings.ads_target}
                    onChange={(e) =>
                      setSettings({ ...settings, ads_target: Number(e.target.value) || 1 })
                    }
                    onBlur={() => saveSettings({ ads_target: settings.ads_target })}
                    className="mt-1"
                  />
                </label>

                <label className="block">
                  <span className="text-sm">Cooldown between ads (s)</span>
                  <Input
                    type="number"
                    min={0}
                    value={settings.reward_cooldown_s}
                    onChange={(e) =>
                      setSettings({ ...settings, reward_cooldown_s: Number(e.target.value) || 0 })
                    }
                    onBlur={() => saveSettings({ reward_cooldown_s: settings.reward_cooldown_s })}
                    className="mt-1"
                  />
                </label>

                <label className="block">
                  <span className="text-sm">First-visit grace (min)</span>
                  <Input
                    type="number"
                    min={0}
                    value={settings.grace_minutes}
                    onChange={(e) =>
                      setSettings({ ...settings, grace_minutes: Number(e.target.value) || 0 })
                    }
                    onBlur={() => saveSettings({ grace_minutes: settings.grace_minutes })}
                    className="mt-1"
                  />
                </label>

                <label className="block">
                  <span className="text-sm">Price (USD)</span>
                  <Input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={settings.price_usd}
                    onChange={(e) =>
                      setSettings({ ...settings, price_usd: Number(e.target.value) || 0.01 })
                    }
                    onBlur={() => saveSettings({ price_usd: settings.price_usd })}
                    className="mt-1"
                  />
                </label>

                <div className="pt-2 flex items-center justify-between">
                  <Button
                    onClick={() => saveSettings(settings)}
                    disabled={settingsBusy}
                    size="sm"
                  >
                    {settingsBusy ? "Saving…" : "Save settings"}
                  </Button>
                  {settingsSavedMsg && (
                    <span className="text-xs text-green-500 font-medium">
                      Settings saved
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            )}
          </CardContent>
        </Card>

        {/* Manual grant */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BadgeCheck className="w-3.5 h-3.5 text-primary" /> Manual grant
            </CardTitle>
            <CardDescription>Fallback when payments aren't wired up.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block">
              <span className="text-sm">Email or username</span>
              <Input
                type="text"
                placeholder="user@example.com or username"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-sm">Days</span>
              <Input
                type="number"
                min={1}
                max={365}
                value={grantDays}
                onChange={(e) => setGrantDays(e.target.value)}
                className="mt-1"
              />
            </label>
            <Button onClick={grant} disabled={grantBusy || !grantEmail.trim()}>
              Grant premium
            </Button>
            {grantMsg && (
              <p className={`text-xs ${grantMsg.startsWith("Granted") ? "text-green-500" : "text-destructive"}`}>
                {grantMsg}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active/expired premium users */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Granted premium</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No premium grants yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Earn (today)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div className="text-sm font-medium truncate max-w-40">
                        {u.display_name ?? u.username ?? u.email ?? u.user_id}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-40">{u.email ?? u.user_id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_premium ? "approved" : "rejected"}>
                        {u.is_premium ? "Active" : "Expired"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {u.premium_expires_at
                        ? new Date(u.premium_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {u.ads_seen_count}
                      {u.last_rewarded_at ? ` · ${formatRelativeTime(u.last_rewarded_at)}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}