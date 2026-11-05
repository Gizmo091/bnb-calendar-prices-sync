/**
 * Service worker : au clic sur l'icône, demande à la page courante d'ouvrir
 * ou fermer le panneau. Sert aussi de relais pour les API publiques
 * (vacances scolaires, jours fériés), avec cache dans le stockage local.
 */
import { buildCalendarContext } from './core/holidays.js';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.tabs.sendMessage(tab.id, { target: 'panel', action: 'toggle' });
    }
    catch {
        // Pas de script de contenu ici : page hors Airbnb / Abritel, ou page à recharger.
        // On affiche l'avertissement dans la page ; sur une page où rien ne peut
        // être injecté (chrome://, boutique), on se rabat sur le badge.
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/notice.js'] });
        }
        catch {
            await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
            await chrome.action.setTitle({ tabId: tab.id, title: 'Ouvrez le calendrier hôte Airbnb ou Abritel (rechargez la page si besoin)' });
        }
    }
});

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
                throw new Error(`Action inconnue : ${msg.action}`);
            }
        }
        catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
    })();
    return true;
});
