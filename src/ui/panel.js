/**
 * Panneau injecté dans la page du site (overlay), isolé par un Shadow DOM.
 * Enchaînement : lire ou importer les prix → confirmer le prix de base →
 * projeter sur l'année suivante → simuler → appliquer.
 *
 * L'adaptateur est appelé directement : on est dans la page.
 * Les appels aux API publiques passent par le service worker (CORS, cache).
 */
import {
    yearBounds, today, yearOf,
    labelYear, describeRuleKey,
    inferRules, generateYear,
    detectBasePrice, planUpdates,
    createExport, validateExport, scalePrices,
    describeOp,
} from '../core/index.js';

const HOST_ID = 'bnb-calendar-prices-sync';

const TEMPLATE = `
<div class="panel" id="panel">
  <header id="drag-handle">
    <strong>BnB Calendar Prices Sync</strong>
    <span id="site-info" class="muted"></span>
    <span class="spacer"></span>
    <button id="collapse" type="button" title="Réduire">–</button>
    <button id="close" type="button" title="Fermer">×</button>
  </header>

  <div class="body" id="body">
    <section>
      <h2>1. Lire ou importer les prix</h2>
      <div class="row">
        <label>Année <input id="year" type="number" min="2020" max="2100"></label>
        <button id="read" type="button">Lire le calendrier</button>
        <button id="export" type="button" disabled>Exporter JSON</button>
        <label class="file">Importer JSON <input id="import" type="file" accept="application/json"></label>
      </div>
      <p id="read-summary" class="muted"></p>
    </section>

    <section>
      <h2>2. Prix de base</h2>
      <div class="row">
        <label>Prix de base <input id="base-price" type="number" min="0" step="1"></label>
        <span id="base-hint" class="muted"></span>
      </div>
    </section>

    <section>
      <h2>3. Reporter sur l'année suivante, ou reprendre tels quels</h2>
      <div class="row">
        <label>Vers <input id="target-year" type="number" min="2020" max="2100"></label>
        <label>Coef. <input id="factor" type="number" min="0.1" step="0.01" value="1"></label>
        <label>Arrondi <input id="rounding" type="number" min="1" step="1" value="1"></label>
        <button id="project" type="button" disabled>Calculer la projection</button>
        <button id="as-is" type="button" disabled title="Reprend les nuits chargées sans projection, sur la même année">Appliquer tels quels</button>
      </div>
      <details id="rules-details" hidden>
        <summary>Règles inférées</summary>
        <table id="rules-table"><thead><tr><th>Période</th><th class="num">Prix</th><th class="num">Nuits</th><th class="num">Cohérence</th></tr></thead><tbody></tbody></table>
      </details>
    </section>

    <section>
      <h2>4. Simuler puis appliquer</h2>
      <div class="row">
        <label><input id="overwrite" type="checkbox"> Écraser aussi les prix personnalisés</label>
        <label>Pause (ms) <input id="delay" type="number" min="200" step="100" value="1500"></label>
      </div>
      <div class="row">
        <button id="plan" type="button" disabled>Simuler</button>
        <button id="apply" type="button" disabled class="danger">Appliquer sur le site</button>
      </div>
      <p id="plan-summary" class="muted"></p>
      <table id="plan-table" hidden><thead><tr><th>Du</th><th>Au</th><th class="num">Nuits</th><th class="num">Prix</th><th>État</th></tr></thead><tbody></tbody></table>
      <details id="skipped-details" hidden>
        <summary>Nuits ignorées</summary>
        <ul id="skipped-list"></ul>
      </details>
    </section>

    <section>
      <h2>Journal</h2>
      <pre id="log"></pre>
    </section>
  </div>
</div>`;

export async function togglePanel(adapter) {
    const existing = document.getElementById(HOST_ID);
    if (existing) {
        existing.remove();
        return;
    }
    await mountPanel(adapter);
}

async function mountPanel(adapter) {
    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = await (await fetch(chrome.runtime.getURL('src/ui/styles.css'))).text();
    shadow.append(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = TEMPLATE;
    shadow.append(wrapper);
    document.body.append(host);

    const $ = (id) => shadow.getElementById(id);
    const info = await adapter.info();
    const storageKey = `panelState:${info.site}:${info.listingId ?? 'unknown'}`;

    const state = {
        site: info.site,
        listingId: info.listingId,
        year: null,
        days: null,
        rules: null,
        proposed: null,
        targetYear: null,
        plan: null,
    };

    $('site-info').textContent = `${adapter.label}${info.listingId ? ` · annonce ${info.listingId}` : ''}${info.calibrated ? '' : ' · adaptateur non calibré'}`;

    function log(message, level = 'info') {
        const prefix = { info: '•', ok: '✓', error: '✗' }[level] ?? '•';
        $('log').textContent += `${new Date().toLocaleTimeString()} ${prefix} ${message}\n`;
        $('log').scrollTop = $('log').scrollHeight;
    }

    async function callBackground(action, params = {}) {
        const response = await chrome.runtime.sendMessage({ target: 'background', action, ...params });
        if (!response?.ok) {
            throw new Error(response?.error ?? 'Pas de réponse du service worker');
        }
        return response.result;
    }

    async function persist() {
        await chrome.storage.local.set({
            [storageKey]: {
                year: state.year,
                days: state.days,
                basePrice: Number($('base-price').value) || null,
                targetYear: Number($('target-year').value) || null,
            },
        });
    }

    /* ---------- 1. Lecture, export, import ---------- */

    function setDays(days, year, origin) {
        state.days = days;
        state.year = year;
        $('year').value = year;
        const count = Object.keys(days).length;
        $('read-summary').textContent = `${count} nuits chargées (${origin}) pour ${year}.`;
        $('export').disabled = count === 0;
        $('project').disabled = count === 0;
        $('as-is').disabled = count === 0;
        $('plan').disabled = true;
        $('apply').disabled = true;
        suggestBasePrice(days, year);
        log(`${count} nuits chargées pour ${year} (${origin})`, 'ok');
        persist();
    }

    async function suggestBasePrice(days, year) {
        const hints = [];
        const fromSite = adapter.basePrice ? await adapter.basePrice().catch(() => null) : null;
        if (fromSite) {
            hints.push(`panneau Tarification du site : ${fromSite}`);
        }
        const far = detectBasePrice(days);
        const near = detectBasePrice(days, { horizonMonths: 0, from: `${year}-01-01` });
        const pick = far.samples ? far : near;
        if (pick.price !== null) {
            hints.push(`prix le plus fréquent sur ${pick.samples} nuits${far.samples ? ' lointaines' : ''} : ${pick.price} (${Math.round(pick.share * 100)} %)`);
        }
        const suggested = fromSite ?? pick.price;
        if (suggested !== null && !$('base-price').value) {
            $('base-price').value = suggested;
        }
        $('base-hint').textContent = hints.length ? `Détecté — ${hints.join(' ; ')}. Vérifiez.` : 'Impossible de détecter le prix de base, saisissez-le.';
    }

    async function readCalendar() {
        const year = Number($('year').value);
        const { from, to } = yearBounds(year);
        log(`Lecture du calendrier du ${from} au ${to}…`);
        try {
            const days = await adapter.readCalendar({ from, to });
            setDays(days, year, 'lecture du site');
        }
        catch (e) {
            log(e.message, 'error');
        }
    }

    function exportJson() {
        const doc = createExport({
            site: state.site,
            listingId: state.listingId,
            basePrice: Number($('base-price').value) || null,
            days: state.days,
        });
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prices-${doc.site}-${state.year}.json`;
        a.click();
        URL.revokeObjectURL(url);
        log(`Export ${a.download}`, 'ok');
    }

    async function importJson(file) {
        try {
            const doc = JSON.parse(await file.text());
            const errors = validateExport(doc);
            if (errors.length) {
                throw new Error(`Fichier invalide : ${errors.join(' ; ')}`);
            }
            const years = new Set(Object.keys(doc.days).map(yearOf));
            const year = years.size === 1 ? [...years][0] : Number($('year').value);
            if (doc.basePrice) {
                $('base-price').value = doc.basePrice;
            }
            $('target-year').value = year + 1;
            setDays(doc.days, year, `import ${file.name}`);
        }
        catch (e) {
            log(e.message, 'error');
        }
    }

    /* ---------- 2 et 3. Règles et projection ---------- */

    async function project() {
        const basePrice = Number($('base-price').value);
        if (!basePrice) {
            log('Renseignez le prix de base avant de projeter', 'error');
            return;
        }
        const targetYear = Number($('target-year').value);
        try {
            log(`Chargement des vacances scolaires et jours fériés ${state.year} et ${targetYear}…`);
            const [ctxSource, ctxTarget] = await Promise.all([
                callBackground('calendarContext', { year: state.year }),
                callBackground('calendarContext', { year: targetYear }),
            ]);
            if (!ctxTarget.schoolPeriods.some((p) => p.start.startsWith(String(targetYear)) && p.season === 'noel')) {
                log(`Attention : les vacances de Noël ${targetYear} ne sont pas encore publiées, décembre retombera sur le hors-saison.`, 'error');
            }
            state.rules = inferRules(state.days, labelYear(state.year, ctxSource));
            renderRules(state.rules);
            const factor = Number($('factor').value) || 1;
            const rounding = Number($('rounding').value) || 1;
            state.proposed = scalePrices(generateYear(targetYear, state.rules, ctxTarget, basePrice), factor, rounding);
            state.targetYear = targetYear;
            log(`${Object.keys(state.rules).length} règles inférées, ${Object.keys(state.proposed).length} nuits projetées sur ${targetYear}`, 'ok');
            $('plan').disabled = false;
            persist();
        }
        catch (e) {
            log(e.message, 'error');
        }
    }

    /** Même année, sans projection : les nuits chargées deviennent les prix proposés. */
    function useAsIs() {
        const factor = Number($('factor').value) || 1;
        const rounding = Number($('rounding').value) || 1;
        const proposed = {};
        for (const [date, day] of Object.entries(state.days)) {
            if (typeof day.price === 'number') {
                proposed[date] = { price: day.price, source: 'import', rule: null };
            }
        }
        state.proposed = scalePrices(proposed, factor, rounding);
        state.targetYear = state.year;
        state.rules = null;
        $('target-year').value = state.year;
        $('rules-details').hidden = true;
        log(`${Object.keys(state.proposed).length} nuits de ${state.year} reprises telles quelles${factor !== 1 ? ` (× ${factor})` : ''}`, 'ok');
        $('plan').disabled = false;
        persist();
    }

    function renderRules(rules) {
        const tbody = $('rules-table').querySelector('tbody');
        tbody.innerHTML = '';
        for (const key of Object.keys(rules).sort()) {
            const r = rules[key];
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${describeRuleKey(key)}</td><td class="num">${r.price}</td><td class="num">${r.samples}</td><td class="num">${Math.round(r.share * 100)} %</td>`;
            tbody.append(tr);
        }
        $('rules-details').hidden = false;
        $('rules-details').open = true;
    }

    /* ---------- 4. Simulation et application ---------- */

    async function plan() {
        const basePrice = Number($('base-price').value);
        const { from, to } = yearBounds(state.targetYear);
        log(`Lecture des prix actuels de ${state.targetYear} pour comparaison…`);
        let current;
        try {
            current = await adapter.readCalendar({ from, to });
        }
        catch (e) {
            log(`${e.message} — simulation faite en supposant toutes les nuits au prix de base.`, 'error');
            current = Object.fromEntries(Object.keys(state.proposed).map((d) => [d, { price: basePrice, custom: false }]));
        }
        state.plan = planUpdates(current, state.proposed, {
            basePrice,
            overwriteCustom: $('overwrite').checked,
            weekdayPattern: adapter.supportsWeekdayPattern === true,
            notBefore: today(),
        });
        renderPlan(state.plan);
        $('apply').disabled = state.plan.ops.length === 0;
    }

    function renderPlan(p) {
        $('plan-summary').textContent = `${p.changed} nuits à modifier en ${p.ops.length} opérations · ${p.unchanged} déjà au bon prix · ${p.skipped.length} ignorées${p.past ? ` · ${p.past} passées non traitées` : ''}.`;
        const tbody = $('plan-table').querySelector('tbody');
        tbody.innerHTML = '';
        for (const op of p.ops) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${op.from}</td><td>${op.to}</td><td class="num">${op.nights}</td><td class="num">${describeOp(op)}</td><td class="state">en attente</td>`;
            tbody.append(tr);
        }
        $('plan-table').hidden = p.ops.length === 0;
        const ul = $('skipped-list');
        ul.innerHTML = '';
        for (const s of p.skipped) {
            const li = document.createElement('li');
            const reasons = {
                custom: `déjà personnalisé (${s.current} ≠ ${s.proposed})`,
                reserved: `réservée (${s.current} conservé)`,
                unknown: 'absente du calendrier',
            };
            li.textContent = `${s.date} : ${reasons[s.reason] ?? s.reason}`;
            ul.append(li);
        }
        $('skipped-details').hidden = p.skipped.length === 0;
        log(`Simulation : ${p.ops.length} opérations, ${p.skipped.length} nuits ignorées`, 'ok');
    }

    async function apply() {
        const delay = Number($('delay').value) || 1500;
        const rows = $('plan-table').querySelectorAll('tbody tr');
        $('apply').disabled = true;
        $('plan').disabled = true;
        let done = 0;
        for (const [i, op] of state.plan.ops.entries()) {
            const cell = rows[i].querySelector('.state');
            cell.textContent = 'en cours…';
            try {
                await adapter.applyPrice(op);
                cell.textContent = 'fait';
                cell.className = 'state state-done';
                done += 1;
            }
            catch (e) {
                cell.textContent = e.message;
                cell.className = 'state state-error';
                log(`Arrêt : ${e.message}`, 'error');
                break;
            }
            await new Promise((r) => setTimeout(r, delay));
        }
        log(`${done}/${state.plan.ops.length} opérations appliquées`, done === state.plan.ops.length ? 'ok' : 'error');
        $('plan').disabled = false;
    }

    /* ---------- Déplacement et repli du panneau ---------- */

    function makeDraggable(panel, handle) {
        let start = null;
        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', (e) => {
            if (!start) {
                return;
            }
            panel.style.left = `${Math.max(0, e.clientX - start.x)}px`;
            panel.style.top = `${Math.max(0, e.clientY - start.y)}px`;
            panel.style.right = 'auto';
        });
        handle.addEventListener('pointerup', () => { start = null; });
    }

    /* ---------- Câblage et restauration ---------- */

    const currentYear = yearOf(today());
    $('year').value = currentYear;
    $('target-year').value = currentYear + 1;
    $('year').addEventListener('change', () => { $('target-year').value = Number($('year').value) + 1; });
    $('base-price').addEventListener('change', persist);
    $('read').addEventListener('click', readCalendar);
    $('export').addEventListener('click', exportJson);
    $('import').addEventListener('change', (e) => e.target.files[0] && importJson(e.target.files[0]));
    $('project').addEventListener('click', project);
    $('as-is').addEventListener('click', useAsIs);
    $('plan').addEventListener('click', plan);
    $('apply').addEventListener('click', apply);
    $('close').addEventListener('click', () => host.remove());
    $('collapse').addEventListener('click', () => {
        const collapsed = $('body').toggleAttribute('hidden');
        $('collapse').textContent = collapsed ? '+' : '–';
    });
    makeDraggable($('panel'), $('drag-handle'));

    const saved = (await chrome.storage.local.get(storageKey))[storageKey];
    if (saved?.days) {
        if (saved.basePrice) {
            $('base-price').value = saved.basePrice;
        }
        if (saved.targetYear) {
            $('target-year').value = saved.targetYear;
        }
        setDays(saved.days, saved.year, 'session précédente');
    }
}
