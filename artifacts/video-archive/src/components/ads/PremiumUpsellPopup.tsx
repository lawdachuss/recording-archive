import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Sparkles, ShieldCheck } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/contexts/PremiumContext";
import { wasUpsellShown, markUpsellShown } from "@/lib/gating";
import { trackActivity } from "@/lib/rum";

const UPSELL_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * PremiumUpsellPopup — appears once per 24h per device, right after the
 * first-visit ad-free grace window ends, then enables ads (the user has now
 * seen the upsell and knows premium exists).
 */
export function PremiumUpsellPopup() {
  const { agePassed, inGrace, isPremium, excludedPage, config } = usePremium();
  const [open, setOpen] = useState(false);

  const graceOver = agePassed && !inGrace && !isPremium;
  const shouldFire = graceOver && !excludedPage && !isPremium;
  const price = config?.price_usd ?? 4.99;

  useEffect(() => {
    if (!shouldFire || open) return;
    if (wasUpsellShown(UPSELL_EVERY_MS)) return;
    const id = window.setTimeout(() => {
      setOpen(true);
      markUpsellShown();
      trackActivity("upsell_shown", { value: 1 });
    }, 1_200);
    return () => window.clearTimeout(id);
  }, [shouldFire, open]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <Dialog.Content>
        <Dialog.Header>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            <Dialog.Title className="text-base">Go ad-free with VAULT Premium</Dialog.Title>
          </div>
          <Dialog.Description>
            Enjoy the archive without interruption.
          </Dialog.Description>
        </Dialog.Header>

        <div className="space-y-3 mt-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            No ads everywhere — for 30 days
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            Just {`$${price.toFixed(2)}`}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Link to="/premium" onClick={() => setOpen(false)}>
            <Button className="w-full">See options</Button>
          </Link>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setOpen(false)}>
            Maybe later
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}