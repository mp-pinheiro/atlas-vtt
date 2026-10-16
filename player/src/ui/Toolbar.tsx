import type { ReactElement } from 'react';
import { Crosshair, Dices, Hand, Move, Ruler } from 'lucide-react';
import { ToolButton } from '../../../src/app/packages/components/primitives/ToolButton.tsx';
import { playerText } from '../i18n.ts';

export type PlayerTool = 'select' | 'pan' | 'dice' | 'measure' | 'laser';

export interface ToolbarProps {
  readonly active: PlayerTool;
  readonly onSelect: (tool: PlayerTool) => void;
}

const tools: readonly { readonly id: PlayerTool; readonly icon: typeof Move; readonly label: string }[] = [
  { id: 'select', icon: Move, label: playerText('toolSelect') },
  { id: 'pan', icon: Hand, label: playerText('toolPan') },
  { id: 'dice', icon: Dices, label: playerText('toolDice') },
  { id: 'measure', icon: Ruler, label: playerText('toolMeasure') },
  { id: 'laser', icon: Crosshair, label: playerText('toolLaser') },
];

export function Toolbar({ active, onSelect }: ToolbarProps): ReactElement {
  return <nav className="atlas-player__toolbar" aria-label={playerText('tabMap')}>
    {tools.map((tool) => <ToolButton key={tool.id} icon={tool.icon} label={tool.label} isActive={active === tool.id} onClick={() => onSelect(tool.id)} />)}
  </nav>;
}
