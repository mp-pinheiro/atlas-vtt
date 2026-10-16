import './bootstrap.ts';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '../../src/app/packages/components/primitives/tooltip.tsx';
import { App } from './App.tsx';


const root = document.getElementById('root');
if (root === null) throw new Error('Player root element is missing');

createRoot(root).render(<TooltipProvider delayDuration={300}><App /></TooltipProvider>);
