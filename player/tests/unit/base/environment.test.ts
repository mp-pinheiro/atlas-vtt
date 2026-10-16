import { describe, expect, it } from 'vitest';
import { getDomHost } from '../../../../src/app/host/dom';

/** Opens a database, stores one value and reads it back. */
function roundTrip(name: string, value: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = (): void => { open.result.createObjectStore('values'); };
    open.onerror = (): void => reject(new Error(open.error?.message ?? 'The database did not open'));
    open.onsuccess = (): void => {
      const transaction = open.result.transaction('values', 'readwrite');
      transaction.objectStore('values').put(value, 'key');
      const read = transaction.objectStore('values').get('key');
      transaction.oncomplete = (): void => {
        open.result.close();
        resolve(typeof read.result === 'string' ? read.result : undefined);
      };
      transaction.onerror = (): void => reject(new Error(transaction.error?.message ?? 'The transaction failed'));
    };
  });
}

describe('the player test project', () => {
  it('has an IndexedDB, as the browser has', async () => {
    await expect(roundTrip('atlas-player-environment', 'explored')).resolves.toBe('explored');
  });

  it('has no Obsidian helpers on the DOM, as the browser has none', () => {
    expect('createDiv' in document.body).toBe(false);
    expect('createEl' in window).toBe(false);
    expect('instanceOf' in document.body).toBe(false);
  });

  it('binds a DOM host for the shared code it loads', () => {
    expect(getDomHost().activeDocument()).toBe(document);
  });
});
