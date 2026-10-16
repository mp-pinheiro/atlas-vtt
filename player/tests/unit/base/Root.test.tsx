import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../../src/app/i18n';
import { Root, tableCodeFromHash } from '../../../src/app/Root';

const CODE = 'abcdefghijklmnopqrstuvwxyz'.slice(0, 20) + '234567';

/** Sets the address fragment and tells the page, as a browser does when the fragment changes. */
function visit(hash: string): void {
  window.history.replaceState(null, '', `/${hash}`);
  act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

describe('tableCodeFromHash', () => {
  it('takes a table code after the #', () => {
    expect(tableCodeFromHash(`#${CODE}`)).toBe(CODE);
    expect(tableCodeFromHash(CODE)).toBe(CODE);
  });

  it.each([
    ['nothing', ''],
    ['a lone #', '#'],
    ['too short', `#${CODE.slice(1)}`],
    ['too long', `#${CODE}a`],
    ['capital letters', `#${CODE.toUpperCase()}`],
    ['digits base32 leaves out', `#${CODE.slice(0, 25)}1`],
    ['something after the code', `#${CODE}&x=1`],
    ['a path', `#/tables/${CODE}`],
  ])('rejects %s', (_name, hash) => {
    expect(tableCodeFromHash(hash)).toBeNull();
  });
});

describe('Root', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('asks for the link when the address has no table code', () => {
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Atlas VTT' })).toBeTruthy();
    expect(screen.getByText('Open the link your GM gave you.')).toBeTruthy();
    expect(screen.queryByText('Table code')).toBeNull();
  });

  it('shows the table code the link carries', () => {
    window.history.replaceState(null, '', `/#${CODE}`);
    render(<Root />);
    expect(screen.getByText(CODE).tagName).toBe('CODE');
    expect(screen.getByText('Table code')).toBeTruthy();
    expect(screen.queryByText('Open the link your GM gave you.')).toBeNull();
  });

  it('asks for the link when the fragment is no table code', () => {
    window.history.replaceState(null, '', '/#welcome');
    render(<Root />);
    expect(screen.getByText('Open the link your GM gave you.')).toBeTruthy();
  });

  it('follows the address when its fragment changes', () => {
    render(<Root />);
    visit(`#${CODE}`);
    expect(screen.getByText(CODE)).toBeTruthy();
    visit('');
    expect(screen.getByText('Open the link your GM gave you.')).toBeTruthy();
  });

  it('carries the class the shared components are styled under', () => {
    const { container } = render(<Root />);
    expect(container.querySelector('main.atlas-vtt-plugin')).not.toBeNull();
  });

  it('speaks English for a text its language has no translation of yet', () => {
    setLocale('ru');
    render(<Root />);
    expect(screen.getByText('Open the link your GM gave you.')).toBeTruthy();
  });
});
