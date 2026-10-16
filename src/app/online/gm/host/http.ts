export interface HttpRequest { readonly url: string; readonly method: 'GET' | 'POST'; readonly authorization?: string; readonly form?: Readonly<Record<string, string>>; }
export interface HttpResponse { readonly status: number; readonly json: unknown; }
export type Http = (request: HttpRequest) => Promise<HttpResponse>;
export function field(json: unknown, name: string): unknown { return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>)[name] : undefined; }
