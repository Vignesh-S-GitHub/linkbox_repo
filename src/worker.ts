import { Hono } from 'hono';

type Bindings = { DB: D1Database; SEEDR_MODE: string; };
const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => c.json({ ok:true, mode:c.env.SEEDR_MODE || 'mock' }));
app.get('/api/storage', (c) => c.json({ totalGb:9.5, usedGb:6.2, availableGb:3.3 }));
app.get('/api/downloads', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM downloads WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  return c.json(rows.results);
});
app.post('/api/downloads', async (c) => {
  const body = await c.req.json<{ magnet?:string }>();
  if (!body.magnet?.startsWith('magnet:?')) return c.json({ error:'Invalid magnet link' },400);
  const id=crypto.randomUUID(), now=Date.now();
  await c.env.DB.prepare(`INSERT INTO downloads (id, public_id, display_name, size_bytes, status, progress, created_at, cleanup_allowed_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id,id,'New download',0,'queued',0,now,now+3*3600000,now+24*3600000,now).run();
  return c.json({ id,status:'queued' },201);
});
app.post('/api/downloads/:id/cleanup', async (c) => {
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT * FROM downloads WHERE public_id = ? AND deleted_at IS NULL').bind(id).first<any>();
  if(!row) return c.json({error:'Not found'},404);
  if(Date.now()<Number(row.cleanup_allowed_at)) return c.json({error:'Protected from cleanup'},409);
  await c.env.DB.prepare('UPDATE downloads SET deleted_at = ?, status = ?, updated_at = ? WHERE public_id = ? AND deleted_at IS NULL').bind(Date.now(),'deleted',Date.now(),id).run();
  return c.json({ok:true});
});

async function cleanupExpired(env:Bindings){
  const now=Date.now();
  const expired=await env.DB.prepare('SELECT public_id FROM downloads WHERE deleted_at IS NULL AND expires_at <= ?').bind(now).all<any>();
  for(const row of expired.results){
    await env.DB.prepare('UPDATE downloads SET deleted_at = ?, status = ?, updated_at = ? WHERE public_id = ? AND deleted_at IS NULL').bind(now,'expired',now,row.public_id).run();
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event:ScheduledEvent, env:Bindings, _ctx:ExecutionContext){ await cleanupExpired(env); }
};
