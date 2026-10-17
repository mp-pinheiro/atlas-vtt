import type { ReactElement } from 'react';
import { Crosshair, Dices, Hand, Maximize, Move, Ruler } from 'lucide-react';
import { ToolButton } from '../../../src/app/packages/components/primitives/ToolButton.tsx';
import { playerText } from '../i18n.ts';

export type PlayerTool = 'select' | 'pan' | 'dice' | 'measure' | 'laser';

export interface ToolbarProps {
  readonly active: PlayerTool;
  readonly diceOpen?: boolean;
  readonly onSelect: (tool: PlayerTool) => void;
  readonly onFit: () => void;
}

const tools = [
  { id: 'select', icon: Move, label: playerText('toolSelect') },
  { id: 'pan', icon: Hand, label: playerText('toolPan') },
  { id: 'measure', icon: Ruler, label: playerText('toolMeasure') },
  { id: 'laser', icon: Crosshair, label: playerText('toolLaser') },
] as const;

export function Toolbar({ active, diceOpen = false, onSelect, onFit }: ToolbarProps): ReactElement {
  return <nav className="atlas-player__toolbar" aria-label={playerText('tabMap')}>
    {tools.map((tool) => <ToolButton key={tool.id} icon={tool.icon} label={tool.label} isActive={active === tool.id} onClick={() => onSelect(tool.id)} />)}
    <ToolButton icon={Maximize} label={playerText('fitMap')} isActive={false} onClick={onFit} />
    <span className="atlas-player__toolbar-divider" aria-hidden="true" />
    <ToolButton icon={Dices} label={playerText('toolDice')} isActive={diceOpen} onClick={() => onSelect('dice')} />
  </nav>;
}
