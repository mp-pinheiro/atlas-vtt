import { FEEDBACK_PATH, REPORTS_PATH } from '../../../src/app/online/protocol/diagnostics.ts';
import { account } from './account.ts';
import { methodNotAllowed, noContent, notFound } from './responses.ts';
import { createTable } from './tables.ts';

type Handle = (request: Request, env: Cloudflare.Env) => Response | Promise<Response>;

/** A path of the relay under `/api/`, the one method it takes and what answers it. */
interface Route {
  readonly method: 'GET' | 'POST';
  readonly handle: Handle;
}

/** Error reports and feedback of the companion: answered and forgotten. The body is never read and nothing is stored. */
const discard: Handle = () => noContent();

const ROUTES: ReadonlyMap<string, Route> = new Map([
  ['/api/tables', { method: 'POST', handle: createTable }],
  ['/api/me', { method: 'GET', handle: account }],
  [REPORTS_PATH, { method: 'POST', handle: discard }],
  [FEEDBACK_PATH, { method: 'POST', handle: discard }],
]);

/** Answers a request for a path under `/api/`: its route, 405 for the wrong method, 404 for any path the relay has no route for. */
export function route(request: Request, env: Cloudflare.Env): Response | Promise<Response> {
  const found = ROUTES.get(new URL(request.url).pathname);
  if (found === undefined) return notFound();
  return request.method === found.method ? found.handle(request, env) : methodNotAllowed(found.method);
}
