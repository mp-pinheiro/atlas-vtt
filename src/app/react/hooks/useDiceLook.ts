import { useEffect, useState } from 'react';
import type { App } from 'obsidian';
import { DEFAULT_DICE_LOOK, type DiceLook } from '../../dice3d/diceLook';
import { SettingsService } from '../../services/SettingsService';

// The class lives with the look, which the players' browser client shares; the hooks still offer it.
export { diceFontClass } from '../../dice3d/diceLook';

/** The dice look from Atlas' settings, kept current as it changes. */
export function useDiceLook(app: App | undefined): DiceLook {
  const settings = SettingsService.forApp(app);
  const [look, setLook] = useState<DiceLook>(() => settings?.getDiceLook() ?? { ...DEFAULT_DICE_LOOK });

  useEffect(() => {
    if (!settings) return;
    const update = (): void => {
      const next = settings.getDiceLook();
      setLook((prev) => (prev.colour === next.colour && prev.font === next.font ? prev : next));
    };
    update();
    return settings.onChange(update);
  }, [settings]);

  return look;
}
