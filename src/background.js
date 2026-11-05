/**
 * Service worker : ouvre le panneau latéral au clic sur l'icône et sert de
 * relais pour les API publiques (vacances scolaires, jours fériés), avec cache
 * dans le stockage local.
 */
import { buildCalendarContext } from './core/holidays.js';
import { t } from './core/i18n.js';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function getCalendarContext(year) {
    const key = `calendarContext:${year}`;
    const cached = (await chrome.storage.local.get(key))[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.value;
    }
    const value = await buildCalendarContext(year);
    await chrome.storage.local.set({ [key]: { fetchedAt: Date.now(), value } });
    return value;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== 'background') {
        return false;
    }
    (async () => {
        try {
            if (msg.action === 'calendarContext') {
                sendResponse({ ok: true, result: await getCalendarContext(msg.year) });
            }
            else {
                throw new Error(t('err_unknown_action', msg.action));
            }
        }
        catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
    })();
    return true;
});
