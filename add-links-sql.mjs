const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsY3d4bnRlaml2Y3FsdXJ1ZHRzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDE1MzYyNywiZXhwIjoyMDk1NzI5NjI3fQ.7Yb2xJsJ5VXU3lv-cQrDqNSo0LHAB8V2fjtMtwEwd00";

async function trySql(query) {
  const url = "https://alcwxntejivcqlurudts.supabase.co/sql";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  console.log(`Status ${res.status}:`, text.substring(0, 500));
  return { ok: res.ok, text };
}

async function main() {
  // Try adding the column
  await trySql(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '{}'::jsonb`);

  // Check if it exists
  await trySql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recordings' ORDER BY ordinal_position`);
}

main().catch(e => console.error(e));
