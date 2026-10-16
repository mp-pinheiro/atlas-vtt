/** Every JSON answer of the relay: never cached, never read cross-origin (the client is served from the same origin, the companion does not use CORS). */
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } as const;

export function json(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** An answer without a body that is kept nowhere: the request is never read. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/** 405 with the one method the path takes. */
export function methodNotAllowed(allow: string): Response {
  return json(405, { error: 'method-not-allowed' }, { Allow: allow });
}

/** Anything under `/api/` that is no route of the relay. */
export function notFound(): Response {
  return json(404, { error: 'not-found' });
}

/** The relay could not do its part: a Durable Object failed or a limit of the plan is spent. The companion says "Try again in a moment". */
export function unavailable(): Response {
  return json(503, { error: 'unavailable' });
}
