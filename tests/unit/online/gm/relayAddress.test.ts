// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeRelayAddress } from '../../../../src/app/online/gm/relayAddress.ts';

describe('the relay address', () => {
  it.each([
    ['https://relay.example', 'https://relay.example'],
    ['  https://relay.example  ', 'https://relay.example'],
    ['https://relay.example/', 'https://relay.example'],
    ['HTTPS://Relay.Example', 'https://relay.example'],
    ['https://relay.example:8443', 'https://relay.example:8443'],
    ['https://relay.example:443', 'https://relay.example'],
    ['https://atlas-relay.team.workers.dev', 'https://atlas-relay.team.workers.dev'],
    ['https://203.0.113.7:9000', 'https://203.0.113.7:9000'],
    ['https://[2001:db8::1]', 'https://[2001:db8::1]'],
    ['https://bücher.example', 'https://xn--bcher-kva.example'],
  ])('takes the https address %j as the origin %j', (input, origin) => {
    expect(normalizeRelayAddress(input)).toBe(origin);
  });

  it.each([
    ['http://localhost:8787', 'http://localhost:8787'],
    ['http://localhost', 'http://localhost'],
    ['HTTP://LocalHost:8787/', 'http://localhost:8787'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['http://[::1]:8787', 'http://[::1]:8787'],
    ['http://[::1]', 'http://[::1]'],
    // The host is judged as the URL parser reads it, so another spelling of the same loopback address passes as it.
    ['http://127.1:8787', 'http://127.0.0.1:8787'],
    ['http://2130706433', 'http://127.0.0.1'],
    ['http://[0:0:0:0:0:0:0:1]', 'http://[::1]'],
    ['https://localhost:8787', 'https://localhost:8787'],
  ])('takes the loopback address %j as the origin %j', (input, origin) => {
    expect(normalizeRelayAddress(input)).toBe(origin);
  });

  it.each([
    'http://relay.example',
    'http://relay.example:8787',
    'http://127.0.0.2:8787',
    'http://localhost.',
    'http://localhost.example',
    'http://[::2]',
    'http://0.0.0.0:8787',
    'http://192.168.1.20:8787',
  ])('refuses %j: http only reaches the GM\'s own machine', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'https://user@relay.example',
    'https://user:secret@relay.example',
    'https://:secret@relay.example',
    'http://user:secret@localhost:8787',
  ])('refuses credentials in %j', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'https://relay.example/api',
    'https://relay.example/api/',
    'https://relay.example//',
    'https://relay.example/./',
    'https://relay.example/%2F',
    'http://localhost:8787/api/tables',
  ])('refuses a path in %j', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'https://relay.example?x=1',
    'https://relay.example/?x=1',
    'https://relay.example/?',
    'https://relay.example?',
    'http://localhost:8787/?token=abc',
  ])('refuses a query in %j, an empty one too', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'https://relay.example#abc',
    'https://relay.example/#abc',
    'https://relay.example/#',
    'https://relay.example#',
    'http://localhost:8787/#table',
  ])('refuses a hash in %j, an empty one too', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'ftp://relay.example',
    'wss://relay.example',
    'ws://localhost:8787',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'app://obsidian.md',
    'mailto:gm@relay.example',
  ])('refuses the scheme of %j', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    '',
    '   ',
    'relay.example',
    'relay.example:8443',
    'localhost:8787',
    '//relay.example',
    'https://',
    'https:///',
    'https:relay.example',
    'https:\\\\relay.example',
    'https:/relay.example',
    'https://relay example',
    'https://relay.example:99999',
    'https://relay.example:port',
    'https://rel<ay.example',
    'https://relay.example\\',
  ])('refuses %j: it names no host', (input) => {
    expect(normalizeRelayAddress(input)).toBeNull();
  });

  it.each([
    'https://rel\nay.example',
    'https://rel\tay.example',
    'https://relay.example\n/api',
    'https://relay.example\u0000',
    'https://relay.example\u0001',
    'https://relay.example\u007f',
    'https://rel ay.example',
    'https://relay.example ',
  ])('refuses a text with whitespace or control characters in it, %j, which the URL parser would clean up and accept', (input) => {
    expect(normalizeRelayAddress(input.trim() === input ? input : `x${input}`)).toBeNull();
  });

  it('gives the same origin again for an origin it returned', () => {
    for (const input of ['https://Relay.Example/', 'http://LOCALHOST:8787/', 'https://relay.example:443']) {
      const origin = normalizeRelayAddress(input);
      expect(origin).not.toBeNull();
      expect(normalizeRelayAddress(origin ?? '')).toBe(origin);
    }
  });
});
