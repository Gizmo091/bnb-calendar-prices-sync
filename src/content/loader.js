/**
 * Script de contenu minimal : charge l'adaptateur du site courant en module ES
 * et l'expose au panneau latéral par messages. Le panneau ne touche jamais la
 * page lui-même : lecture, écriture et détection passent par ici.
 */
(async () => {
    const { pickAdapter } = await import(chrome.runtime.getURL('src/adapters/index.js'));
    const { useLanguage } = await import(chrome.runtime.getURL('src/core/i18n.js'));
    let language = 'auto';
    const adapter = pickAdapter(location.hostname);
    if (!adapter) {
        return;
    }
    const METHODS = ['readCalendar', 'applyPrice', 'basePrice'];

    async function describe() {
        const info = await adapter.info();
        return {
            ...info,
            label: adapter.label,
            supportsWeekdayPattern: adapter.supportsWeekdayPattern === true,
            calendarUrl: adapter.calendarUrl ?? null,
            hasBasePrice: typeof adapter.basePrice === 'function',
        };
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.target !== 'adapter') {
            return false;
        }
        (async () => {
            try {
                if (msg.lang && msg.lang !== language) {
                    language = msg.lang;
                    await useLanguage(language);
                }
                if (msg.method === 'info') {
                    sendResponse({ ok: true, result: await describe() });
                }
                else if (METHODS.includes(msg.method) && typeof adapter[msg.method] === 'function') {
                    sendResponse({ ok: true, result: await adapter[msg.method](...(msg.args ?? [])) });
                }
                else {
                    throw new Error(`Méthode inconnue : ${msg.method}`);
                }
            }
            catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    });
})();
