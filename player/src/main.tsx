import './host/initializeHost';
import { createRoot } from 'react-dom/client';
import { Root } from './app/Root';
import '../../styles/player-theme.scss';

const container = document.getElementById('root');
if (container === null) throw new Error('The page has no element to draw into');
createRoot(container).render(<Root />);
