const SERVICE_KEY = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTcwMDAwMDAwMCwgImV4cCI6IDIwMTUzNjAwMDB9.UTDwoY0L6W6nllK7FvssoFLp3qvAx60PijJyL9XHyXQ";

async function trySql(query) {
  const url = "https://supabase.chuglii.in";
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
