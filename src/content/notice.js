/**
 * Avertissement injecté à la demande, sur une page que l'extension ne sait
 * pas piloter : pas de script de contenu ici, donc pas de panneau. Un second
 * clic sur l'icône retire l'avertissement.
 *
 * Script classique (pas de module) : il est injecté par chrome.scripting et
 * ne peut rien charger depuis l'extension sur un site étranger, d'où les
 * styles en ligne, repris des jetons du panneau.
 */
(() => {
    const HOST_ID = 'bnb-calendar-prices-sync-notice';
    const existing = document.getElementById(HOST_ID);
    if (existing) {
        existing.remove();
        return;
    }
    const SITES = [
        { label: 'Airbnb', hint: 'calendrier hôte', url: 'https://www.airbnb.fr/multicalendar/' },
        { label: 'Abritel / Vrbo', hint: 'calendrier propriétaire', url: 'https://www.abritel.fr/p/calendar/' },
    ];
    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; --surface: #fff; --raised: #f4f4f5; --fg: #171717; --fg-2: #525252; --fg-3: #737373;
            --hairline: rgba(23,23,23,.08); --hairline-strong: rgba(23,23,23,.16); --accent: #2f6f4e; --accent-ink: #25593e;
            --shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.08); }
        @media (prefers-color-scheme: dark) {
            :host { --surface: #19191b; --raised: #232325; --fg: #ededed; --fg-2: #a1a1a6; --fg-3: #85858b;
                --hairline: rgba(237,237,237,.08); --hairline-strong: rgba(237,237,237,.16); --accent: #4cb07e; --accent-ink: #6cc495;
                --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.4); }
        }
        * { box-sizing: border-box; }
        .notice { position: fixed; top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); z-index: 2147483647;
            font: 400 13px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--surface);
            border: 1px solid var(--hairline); border-radius: 16px; box-shadow: var(--shadow); -webkit-font-smoothing: antialiased; }
        header { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--hairline); }
        .brand { font-weight: 500; flex: 1; }
        button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0;
            border-radius: 8px; background: transparent; color: var(--fg-3); cursor: pointer; }
        button:hover { background: var(--raised); color: var(--fg); }
        button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        svg { width: 16px; height: 16px; }
        .body { padding: 16px; }
        p { margin: 0 0 12px; }
        .host { color: var(--fg-2); font: 12px/16px ui-monospace, "SF Mono", Menlo, monospace; word-break: break-all; }
        ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
        li { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: 8px; }
        li span { color: var(--fg-3); font-size: 12px; line-height: 16px; }
        li .url { font-family: ui-monospace, "SF Mono", Menlo, monospace; word-break: break-all; }
        a { color: var(--accent-ink); text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
    `;
    const wrapper = document.createElement('div');
    wrapper.className = 'notice';
    wrapper.innerHTML = `
        <header>
          <span class="brand">BnB Calendar Prices Sync</span>
          <button type="button" title="Fermer" aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="body">
          <p>Ce site n'est pas pris en charge<br><span class="host"></span></p>
          <p>L'extension s'ouvre sur le calendrier d'une annonce, sur l'un de ces sites :</p>
          <ul></ul>
        </div>`;
    wrapper.querySelector('.host').textContent = location.hostname;
    const ul = wrapper.querySelector('ul');
    for (const site of SITES) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = site.url;
        a.textContent = site.label;
        const hint = document.createElement('span');
        hint.textContent = site.hint;
        const url = document.createElement('span');
        url.className = 'url';
        url.textContent = `${site.url}<id de l'annonce>`;
        li.append(a, hint, url);
        ul.append(li);
    }
    wrapper.querySelector('button').addEventListener('click', () => host.remove());
    shadow.append(style, wrapper);
    document.documentElement.append(host);
})();
