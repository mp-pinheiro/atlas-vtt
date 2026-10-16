import { field, type Http } from './http.ts';
export interface RelayAccess { readonly account: { readonly id: string; readonly handle: string; readonly name: string }; readonly access: { readonly plan: string; readonly maxPlayers: number; readonly endsAt: number | null }; }
export type RelayAccessResult = { readonly state: 'ready'; readonly access: RelayAccess } | { readonly state: 'invalid-key' | 'unreachable' };
export async function readRelayAccess(http: Http, origin: string, key: string): Promise<RelayAccessResult> {
  try {
    const response = await http({ url: `${origin}/api/me`, method: 'GET', authorization: `Bearer ${key}` });
    if (response.status === 401) return { state: 'invalid-key' };
    if (response.status !== 200) return { state: 'unreachable' };
    const account = field(response.json, 'account');
    const access = field(response.json, 'access');
    const id = field(account, 'id');
    const handle = field(account, 'handle');
    const name = field(account, 'name');
    const plan = field(access, 'plan');
    const maxPlayers = field(access, 'maxPlayers');
    const endsAt = field(access, 'endsAt');
    if (typeof id !== 'string' || typeof handle !== 'string' || typeof name !== 'string' || typeof plan !== 'string' || typeof maxPlayers !== 'number' || !Number.isInteger(maxPlayers) || maxPlayers < 1) return { state: 'unreachable' };
    return { state: 'ready', access: { account: { id, handle, name }, access: { plan, maxPlayers, endsAt: typeof endsAt === 'number' ? endsAt : null } } };
  } catch { return { state: 'unreachable' }; }
}
