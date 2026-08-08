import { Hono } from 'hono'
import { cors } from 'hono/cors'

export type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

app.get('/api/health', (c) => c.json({ ok: true, service: 'resort-pms-backend' }))

// Smoke-test endpoint: confirms the D1 binding works and the schema is applied.
app.get('/api/units', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, type, name, category, capacity FROM units ORDER BY type, name'
  ).all()
  return c.json(results)
})

export default app