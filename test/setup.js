/** Les libellés sortent du catalogue français, la langue d'origine des tests. */
import { readFileSync } from 'node:fs';
import { setMessages } from '../src/core/i18n.js';

setMessages(JSON.parse(readFileSync(new URL('../_locales/fr/messages.json', import.meta.url), 'utf8')), 'fr-FR');
