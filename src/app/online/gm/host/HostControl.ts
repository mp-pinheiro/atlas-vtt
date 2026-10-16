import type { HostKeyStore } from './hostKeyStore.ts';
import { readRelayOrigin } from './hostSettings.ts';
import { readRelayAccess, type RelayAccess } from './relayAccess.ts';
import type { Http } from './http.ts';
import { t } from '../../../i18n';

export type HostState = 'unconfigured' | 'checking' | 'ready' | 'invalid-key' | 'unreachable' | 'secret-storage-unavailable';
export interface HostControlPorts {
  readonly http: Http;
  readonly store: HostKeyStore;
  readonly origin: () => string;
  readonly saveOrigin: (origin: string) => Promise<void>;
  readonly stopTable: () => void;
  readonly forgetTable: () => void;
  readonly confirmOriginChange: () => Promise<boolean>;
  readonly notify: (text: string) => void;
}

export class HostControl {
  private stateValue: HostState = 'unconfigured';
  private accessValue: RelayAccess | null = null;
  private readonly listeners = new Set<() => void>();
  private stopped = false;
  private revision = 0;
  private keyRevoked = false;

  constructor(private readonly ports: HostControlPorts) {}

  get state(): HostState { return this.stateValue; }
  get origin(): string { return this.ports.origin(); }
  access(): RelayAccess | null { return this.accessValue; }
  key(): string | null { return !this.keyRevoked && this.ports.store.available() ? this.ports.store.get() : null; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    const revision = ++this.revision;
    const origin = this.origin;
    if (!this.ports.store.available()) { this.set('secret-storage-unavailable'); return; }
    const key = this.key();
    if (key === null) { this.set('unconfigured'); return; }
    this.set('checking');
    const answer = await readRelayAccess(this.ports.http, origin, key);
    if (this.stopped || revision !== this.revision || this.origin !== origin || this.key() !== key) return;
    this.accessValue = answer.state === 'ready' ? answer.access : null;
    this.set(answer.state);
  }

  async setKey(value: string): Promise<void> {
    if (this.stopped) return;
    const key = value.trim();
    if (key.length === 0) { await this.clearKey(); return; }
    if (!this.ports.store.available()) {
      this.set('secret-storage-unavailable');
      this.ports.notify(t('onlinePlayer.secureStorageUnavailable'));
      return;
    }
    try {
      this.ports.store.set(key);
      this.keyRevoked = false;
    } catch {
      this.set('secret-storage-unavailable');
      this.ports.notify(t('onlinePlayer.secureStorageUnavailable'));
      return;
    }
    await this.refresh();
  }

  async clearKey(): Promise<void> {
    if (this.stopped) return;
    this.revision++;
    this.keyRevoked = true;
    this.ports.stopTable();
    this.ports.forgetTable();
    this.accessValue = null;
    try {
      this.ports.store.clear();
      this.set('unconfigured');
    } catch {
      this.set('secret-storage-unavailable');
      this.ports.notify(t('onlinePlayer.hostKeyClearFailed'));
    }
  }

  async setOrigin(value: string): Promise<boolean> {
    if (this.stopped) return false;
    const origin = readRelayOrigin(value);
    if (origin === null) return false;
    if (origin === this.origin) return true;
    if (!await this.ports.confirmOriginChange() || this.stopped) return false;
    this.revision++;
    this.ports.stopTable();
    this.ports.forgetTable();
    await this.ports.saveOrigin(origin);
    this.accessValue = null;
    if (!this.ports.store.available()) this.set('secret-storage-unavailable');
    else if (this.key() === null) this.set('unconfigured');
    else await this.refresh();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.revision++;
    this.listeners.clear();
  }

  private set(state: HostState): void {
    this.stateValue = state;
    for (const listener of this.listeners) listener();
  }
}
