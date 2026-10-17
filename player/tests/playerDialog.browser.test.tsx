import { useState, type ReactElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TooltipProvider } from '../../src/app/packages/components/primitives/tooltip.tsx';
import { PlayerDialog } from '../src/ui/PlayerDialog.tsx';

function Reader(): ReactElement {
  const [open, setOpen] = useState(false);
  return <TooltipProvider delayDuration={0}>
    <button type="button" onClick={() => setOpen(true)}>Read note</button>
    {open && <PlayerDialog title="Lantern clue" onClose={() => setOpen(false)}><p>The lantern is beyond the eastern door.</p></PlayerDialog>}
  </TooltipProvider>;
}

afterEach(() => cleanup());

it('closes a reader on the same Escape that dismisses its close tooltip and returns focus', async () => {
  render(<Reader />);
  const trigger = page.getByRole('button', { name: 'Read note' });
  await trigger.click();
  const dialog = await screen.findByRole('dialog', { name: 'Lantern clue' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  screen.getByRole('button', { name: 'Close' }).focus();
  await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger.element());
});
