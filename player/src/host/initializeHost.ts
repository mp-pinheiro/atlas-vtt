import { getLocale } from '../../../src/app/i18n';
import { startLocale } from '../i18n/startLocale';
import { followColorScheme } from './colorScheme';
import { installPlayerDomHost } from './domHost';

// Imported first by main.tsx: shared modules read the DOM host and the language while they load,
// and a module runs only after the modules it imports before it.
installPlayerDomHost();
startLocale();
followColorScheme();
document.documentElement.lang = getLocale();
