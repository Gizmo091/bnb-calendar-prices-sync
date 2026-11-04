/**
 * Script de contenu minimal : charge l'adaptateur du site courant en module ES
 * et ouvre ou ferme le panneau dans la page quand l'icône de l'extension est cliquée.
 */
(async () => {
    const { pickAdapter } = await import(chrome.runtime.getURL('src/adapters/index.js'));
    const adapter = pickAdapter(location.hostname);
    if (!adapter) {
        return;
    }
    const { togglePanel } = await import(chrome.runtime.getURL('src/ui/panel.js'));
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.target !== 'panel') {
            return false;
        }
        togglePanel(adapter).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
        return true;
    });
})();
