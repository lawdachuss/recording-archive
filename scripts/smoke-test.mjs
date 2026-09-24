import { requireKey } from "./env.mjs";
// Smoke test: verify key API endpoints return expected responses
const BASE = 'https://chuglii.in';
const SUPABASE = 'https://supabase.chuglii.in';
const ANON = requireKey("SUPABASE_ANON_KEY");
const SVC = requireKey("SUPABASE_SERVICE_ROLE_KEY");

async function get(url, headers={}) {
  try {
    const r = await fetch(url, { headers });
    return { status: r.status, ok: r.ok };
  } catch(e) { return { error: e.message }; }
}

async function postJson(url, body, headers={}) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    return { status: r.status, ok: r.ok, data };
  } catch(e) { return { error: e.message }; }
}

async function main() {
  console.log('=== API smoke tests ===\n');

  // Public endpoints
  console.log('1. GET /api/recordings');
  console.log(await get(`${BASE}/api/recordings?limit=3`));

  console.log('2. GET /api/performers');
  console.log(await get(`${BASE}/api/performers?limit=3`));

  console.log('3. GET /api/tags');
  console.log(await get(`${BASE}/api/tags?limit=5`));

  console.log('4. GET /api/collections');
  console.log(await get(`${BASE}/api/collections?limit=3`));

  // Auth - sign in with test user
  console.log('\n5. POST auth/token (sign in)');
  const authResp = await postJson(`${SUPABASE}/auth/v1/token?grant_type=password`,
    { email: 'mepive2701@ehwit.com', password: 'testpassword123' },
    { apikey: ANON }
  );
  console.log('Auth result status:', authResp.status);
  if (!authResp.ok) {
    console.log('Auth failed, cannot test authenticated endpoints');
    return;
  }
  const token = authResp.data.access_token;

  console.log('\n6. GET /api/user/profile');
  console.log(await get(`${BASE}/api/user/profile`, { Authorization: `Bearer ${token}` }));

  console.log('\n7. GET /api/user/history');
  console.log(await get(`${BASE}/api/user/history`, { Authorization: `Bearer ${token}` }));

  console.log('\n8. GET /api/user/watch-later');
  console.log(await get(`${BASE}/api/user/watch-later`, { Authorization: `Bearer ${token}` }));

  console.log('\n9. GET /api/user/notifications');
  console.log(await get(`${BASE}/api/user/notifications`, { Authorization: `Bearer ${token}` }));

  console.log('\n10. GET /api/user/follows');
  console.log(await get(`${BASE}/api/user/follows`, { Authorization: `Bearer ${token}` }));

  console.log('\n=== Done ===');
}

main().catch(console.error);
