import { useEffect, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { adsterraPopunderScript, adsterraSocialBarScript, adsterraSmartlinkUrl } from "@/lib/ads";

export default function AdDebug() {
  const premium = usePremium();
  const [loadedScripts, setLoadedScripts] = useState<string[]>([]);

  useEffect(() => {
    // Check which scripts are actually loaded in the DOM
    const scripts = Array.from(document.querySelectorAll('script[src]'))
      .map(s => (s as HTMLScriptElement).src)
      .filter(src => src.includes('adsterra') || src.includes('profitableratecpmnetwork'));
    setLoadedScripts(scripts);
  }, [premium.showAds]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Ad Configuration Debug</h1>

      {/* Premium Context Status */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">Premium Context Status</h2>
        <div className="space-y-2 font-mono text-sm">
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">showAds:</span>
            <span className={premium.showAds ? "text-green-500" : "text-red-500"}>
              {String(premium.showAds)}
            </span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">agePassed:</span>
            <span className={premium.agePassed ? "text-green-500" : "text-red-500"}>
              {String(premium.agePassed)}
            </span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">inGrace:</span>
            <span className={premium.inGrace ? "text-yellow-500" : "text-gray-500"}>
              {String(premium.inGrace)}
            </span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">graceRemainingMs:</span>
            <span>{premium.graceRemainingMs}ms ({Math.ceil(premium.graceRemainingMs / 60000)}min)</span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">isPremium:</span>
            <span className={premium.isPremium ? "text-blue-500" : "text-gray-500"}>
              {String(premium.isPremium)}
            </span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">excludedPage:</span>
            <span>{String(premium.excludedPage)}</span>
          </div>
        </div>
      </section>

      {/* Adsterra Configuration */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">Adsterra Configuration</h2>
        <div className="space-y-4 font-mono text-sm">
          <div>
            <div className="font-semibold mb-1">Popunder Script:</div>
            <div className="pl-4 break-all">
              {adsterraPopunderScript() ? (
                <a href={adsterraPopunderScript()!} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  {adsterraPopunderScript()}
                </a>
              ) : (
                <span className="text-red-500">NOT CONFIGURED</span>
              )}
            </div>
          </div>
          <div>
            <div className="font-semibold mb-1">Social Bar Script:</div>
            <div className="pl-4 break-all">
              {adsterraSocialBarScript() ? (
                <a href={adsterraSocialBarScript()!} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  {adsterraSocialBarScript()}
                </a>
              ) : (
                <span className="text-red-500">NOT CONFIGURED</span>
              )}
            </div>
          </div>
          <div>
            <div className="font-semibold mb-1">Smartlink URL:</div>
            <div className="pl-4 break-all">
              <a href={adsterraSmartlinkUrl()} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                {adsterraSmartlinkUrl()}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Loaded Scripts in DOM */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">Adsterra Scripts Loaded in DOM</h2>
        <div className="space-y-2 font-mono text-sm">
          {loadedScripts.length === 0 ? (
            <div className="text-yellow-500">
              ⚠️ No Adsterra scripts found in DOM. This is expected if showAds = false.
            </div>
          ) : (
            loadedScripts.map((src, i) => (
              <div key={i} className="pl-4 break-all text-green-500">
                ✓ {src}
              </div>
            ))
          )}
        </div>
      </section>

      {/* JuicyAds Configuration */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">JuicyAds Configuration</h2>
        <div className="space-y-2 font-mono text-sm">
          {Object.entries(import.meta.env)
            .filter(([key]) => key.startsWith("VITE_JUICYADS_"))
            .map(([key, value]) => (
              <div key={key} className="flex gap-4">
                <span className="font-semibold min-w-[300px]">{key}:</span>
                <span className={value ? "text-green-500" : "text-red-500"}>
                  {value || "NOT CONFIGURED"}
                </span>
              </div>
            ))}
        </div>
      </section>

      {/* localStorage Debug */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">localStorage Debug</h2>
        <div className="space-y-2 font-mono text-sm">
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">age-gate-passed:</span>
            <span>{localStorage.getItem("age-gate-passed") || "null"}</span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">vault_grace_started_at:</span>
            <span>{localStorage.getItem("vault_grace_started_at") || "null"}</span>
          </div>
          <div className="flex gap-4">
            <span className="font-semibold min-w-[200px]">vault_upsell_shown_at:</span>
            <span>{localStorage.getItem("vault_upsell_shown_at") || "null"}</span>
          </div>
        </div>
      </section>

      {/* Actions */}
      <section className="mb-8 p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">Debug Actions</h2>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => {
              localStorage.removeItem("age-gate-passed");
              localStorage.removeItem("vault_grace_started_at");
              localStorage.removeItem("vault_upsell_shown_at");
              window.location.reload();
            }}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Clear All & Reload
          </button>
          <button
            onClick={() => {
              localStorage.setItem("age-gate-passed", "true");
              localStorage.removeItem("vault_grace_started_at");
              window.location.reload();
            }}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Pass Age Gate (No Grace)
          </button>
          <button
            onClick={() => {
              localStorage.setItem("age-gate-passed", "true");
              localStorage.setItem("vault_grace_started_at", new Date(Date.now() - 11 * 60 * 1000).toISOString());
              window.location.reload();
            }}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Enable Ads (Expired Grace)
          </button>
        </div>
      </section>

      {/* Expected Behavior */}
      <section className="p-6 bg-card rounded-lg border">
        <h2 className="text-xl font-semibold mb-4">Expected Behavior</h2>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p>For ads to show, ALL of these must be true:</p>
          <ul>
            <li>✓ <code>agePassed</code> = true</li>
            <li>✓ <code>inGrace</code> = false (grace period expired)</li>
            <li>✓ <code>isPremium</code> = false</li>
            <li>✓ <code>excludedPage</code> = false</li>
          </ul>
          <p className="mt-4">When all conditions are met, <code>showAds</code> should be <strong>true</strong>.</p>
        </div>
      </section>
    </div>
  );
}
