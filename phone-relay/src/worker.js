// Hourly Logger phone relay — a tiny mailbox between the phone web app
// (served as static assets from this same Worker) and the Mac app.
//
//   phone  → POST /api/entries       one { id, text, ts } per log
//   Mac    → GET  /api/entries       poll for pending entries
//   Mac    → POST /api/entries/ack   delete entries it has committed
//   Mac    → PUT  /api/catalog       categories + remembered phrases
//   phone  → GET  /api/catalog       render the preset chips
//   either → GET  /api/ping          connectivity test
//
// Every route requires `Authorization: Bearer <RELAY_TOKEN>` (a Worker
// secret). The static app itself is public but useless without the token.

const MAX_TEXT = 2000; // mirrors the Mac app's phoneInboxFileSchema
const MAX_CATALOG_BYTES = 100_000;
const MAX_ACK_IDS = 500;
// ~2 min of AAC audio with headroom. Bounds both request size and the
// Workers-AI neurons a single call can burn.
const MAX_AUDIO_BYTES = 10_000_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Non-API, non-asset request (assets are served before we run).
      return new Response('Not found', { status: 404 });
    }
    if (!authorized(request, env)) {
      return json({ error: 'unauthorized' }, 401);
    }
    try {
      return await route(request, env, url.pathname);
    } catch (err) {
      return json({ error: String(err?.message ?? err) }, 500);
    }
  },
};

function authorized(request, env) {
  const h = request.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(env.RELAY_TOKEN) && token === env.RELAY_TOKEN;
}

async function route(request, env, path) {
  const method = request.method;

  if (path === '/api/ping' && method === 'GET') {
    return json({ ok: true });
  }

  if (path === '/api/entries' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id.slice(0, 120) : '';
    const text =
      typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
    const ts = typeof body?.ts === 'string' ? body.ts.slice(0, 64) : null;
    if (!id || !text) return json({ error: 'id and text are required' }, 400);
    // OR IGNORE: the phone retries sends it isn't sure landed, so the
    // same id may arrive twice — first write wins, dup is a no-op.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO entries (id, text, ts, created_at) VALUES (?1, ?2, ?3, ?4)'
    )
      .bind(id, text, ts, new Date().toISOString())
      .run();
    return json({ ok: true });
  }

  if (path === '/api/entries' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, text, ts FROM entries ORDER BY COALESCE(ts, created_at), id'
    ).all();
    return json({ entries: results });
  }

  if (path === '/api/entries/ack' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x) => typeof x === 'string').slice(0, MAX_ACK_IDS)
      : [];
    if (ids.length === 0) return json({ error: 'ids required' }, 400);
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
    await env.DB.prepare(`DELETE FROM entries WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
    return json({ ok: true });
  }

  if (path === '/api/catalog' && method === 'GET') {
    const row = await env.DB.prepare(
      "SELECT value FROM kv WHERE key = 'catalog'"
    ).first();
    if (!row) return json({ categories: [], phrases: [], updatedAt: null });
    return new Response(row.value, {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (path === '/api/catalog' && (method === 'PUT' || method === 'POST')) {
    const raw = await request.text();
    if (raw.length > MAX_CATALOG_BYTES) return json({ error: 'too large' }, 413);
    try {
      JSON.parse(raw);
    } catch {
      return json({ error: 'not JSON' }, 400);
    }
    await env.DB.prepare(
      "INSERT INTO kv (key, value) VALUES ('catalog', ?1) " +
        'ON CONFLICT(key) DO UPDATE SET value = ?1'
    )
      .bind(raw)
      .run();
    return json({ ok: true });
  }

  if (path === '/api/transcribe' && method === 'POST') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) return json({ error: 'no audio' }, 400);
    if (buf.byteLength > MAX_AUDIO_BYTES) return json({ error: 'audio too large' }, 413);
    const res = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: toBase64(buf),
    });
    return json({ text: String(res?.text ?? '').trim() });
  }

  return json({ error: 'not found' }, 404);
}

// ArrayBuffer → base64, chunked so large recordings don't blow the
// argument limit of String.fromCharCode.
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
