/**
 * Reads a JSON body, falling back to an empty object on malformed input.
 * Callers validate the individual fields themselves.
 */
export async function readJson<T extends object = Record<string, unknown>>(c: {
  req: { json: () => Promise<unknown> }
}): Promise<Partial<T>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as Partial<T>) : {}
  } catch {
    return {}
  }
}