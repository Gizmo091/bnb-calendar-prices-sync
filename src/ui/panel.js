/**
 * Panneau injecté dans la page du site (overlay), isolé par un Shadow DOM.
 * Enchaînement : lire ou importer les prix → confirmer le prix de base →
 * projeter sur l'année suivante → simuler → appliquer.
 *
 * L'adaptateur est appelé directement : on est dans la page.
 * Les appels aux API publiques passent par le service worker (CORS, cache).
 */
import {
    yearBounds, today, yearOf, addMonths,
    labelYear, describeRuleKey,
    inferRules, generateYear,
    detectBasePrice, planUpdates,
    createExport, validateExport, scalePrices,
    describeOp, eachDay, weekday, WEEKDAY_NAMES,
} from '../core/index.js';
import { renderYearGrid, priceLevels, describeDate } from './yearGrid.js';

const HOST_ID = 'bnb-calendar-prices-sync';
/** Fenêtre lue sur le site pour trouver le prix de base : au-delà de l'horizon de réservation. */
const FAR_FROM_MONTHS = 18;
const FAR_TO_MONTHS = 24;
const CONFIDENT_SHARE = 0.9;

const SKIP_LABELS = {
    custom: 'déjà personnalisée',
    reserved: 'réservée',
    unknown: 'absente du calendrier',
};


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
    const asset = async (path) => (await fetch(chrome.runtime.getURL(`src/ui/${path}`))).text();
    const [css, html] = await Promise.all([asset('styles.css'), asset('template.html')]);
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
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
        planGrid: null,
    };

    $('site-info').textContent = `${adapter.label}${info.listingId ? ` · annonce ${info.listingId}` : ''}${info.calibrated ? '' : ' · adaptateur non calibré'}`;
    if (!info.listingId) {
        $('notice').innerHTML = `Cette page n'est pas le calendrier d'une annonce. Ouvrez-le pour lire ou modifier les prix : <code>${adapter.calendarUrl}</code>`;
        $('notice').hidden = false;
        $('read').disabled = true;
    }

    function log(message, level = 'info') {
        const line = document.createElement('span');
        line.className = `line ${level}`;
        const time = document.createElement('time');
        time.textContent = new Date().toLocaleTimeString('fr-FR');
        line.append(time, document.createTextNode(message));
        $('log').append(line);
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
        $('read-summary').textContent = `${count} nuits chargées pour ${year} · ${origin}`;
        renderDays(days, year);
        $('export').disabled = count === 0;
        $('project').disabled = count === 0;
        $('as-is').disabled = count === 0;
        $('plan').disabled = true;
        $('apply').disabled = true;
        suggestBasePrice(days, year);
        log(`${count} nuits chargées pour ${year} (${origin})`, 'ok');
        persist();
    }

    /** Grille de l'année chargée : un palier d'accent par niveau de prix, les nuits réservées hachurées. */
    function renderDays(days, year) {
        const { levels, min, max } = priceLevels(days);
        const cells = {};
        for (const [date, day] of Object.entries(days)) {
            const price = typeof day.price === 'number' ? `${day.price} €` : 'prix inconnu';
            const flags = [day.reserved ? 'réservée' : '', day.available === false ? 'bloquée' : '', day.promotion ? 'promotion' : ''].filter(Boolean);
            cells[date] = {
                level: levels[date],
                state: day.reserved ? 'reserved' : undefined,
                title: `${describeDate(date)} · ${price}${flags.length ? ` · ${flags.join(', ')}` : ''}`,
            };
        }
        const legend = min === undefined ? [] : [
            { level: 1, label: `${min} €` },
            { level: 5, label: `${max} €` },
            { state: 'reserved', label: 'réservée' },
        ];
        renderYearGrid($('read-grid'), year, cells, { legend });
    }

    /**
     * Le prix de base est celui qu'affichent les nuits de fin de calendrier,
     * pas encore ouvertes à la réservation et donc jamais personnalisées :
     * on lit sur le site une fenêtre lointaine (de 18 à 24 mois) et on prend
     * le prix dominant. À défaut, le panneau Tarification du site, puis les
     * nuits chargées.
     */
    async function suggestBasePrice(days, year) {
        const hints = [];
        let confident = null;
        const farFrom = addMonths(today(), FAR_FROM_MONTHS);
        const farTo = addMonths(today(), FAR_TO_MONTHS);
        try {
            const farDays = await adapter.readCalendar({ from: farFrom, to: farTo });
            const far = detectBasePrice(farDays, { horizonMonths: 0, from: farFrom });
            if (far.price !== null) {
                hints.push(`${far.price} € sur ${far.samples} nuits de fin de calendrier (${Math.round(far.share * 100)} %)`);
                if (far.share >= CONFIDENT_SHARE) {
                    confident = far.price;
                }
            }
        }
        catch (e) {
            log(`Fin de calendrier illisible (${e.message}), prix de base estimé sur les nuits chargées`, 'error');
        }
        const fromSite = adapter.basePrice ? await adapter.basePrice().catch(() => null) : null;
        if (fromSite) {
            hints.push(`${fromSite} € affiché par le site`);
        }
        const loaded = detectBasePrice(days, { horizonMonths: 0, from: `${year}-01-01` });
        if (confident === null && fromSite === null && loaded.price !== null) {
            hints.push(`${loaded.price} € le plus fréquent sur les ${loaded.samples} nuits chargées (${Math.round(loaded.share * 100)} %), à vérifier`);
        }
        const suggested = confident ?? fromSite ?? loaded.price;
        if (confident !== null || (suggested !== null && !$('base-price').value)) {
            $('base-price').value = suggested;
        }
        $('base-hint').textContent = hints.length ? `Détecté : ${hints.join(' · ')}` : 'Prix de base introuvable, à saisir';
        persist();
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
            const share = Math.round(r.share * 100);
            tr.innerHTML = `<td>${describeRuleKey(key)}</td><td class="num">${r.price}</td><td class="num">${r.samples}</td><td class="num share"><i style="--w:${share}%"></i>${share} %</td>`;
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
        $('plan-summary').textContent = `${p.changed} nuits à modifier en ${p.ops.length} opérations · ${p.unchanged} déjà au bon prix · ${p.skipped.length} ignorées${p.past ? ` · ${p.past} passées` : ''}`;
        const tbody = $('plan-table').querySelector('tbody');
        tbody.innerHTML = '';
        for (const op of p.ops) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="date">${op.from}</td><td class="date">${op.to}</td><td class="num">${op.nights}</td><td class="num">${describeOp(op).split(' · ').join('<br>')}</td><td class="state">en attente</td>`;
            tbody.append(tr);
        }
        $('plan-table').hidden = p.ops.length === 0;
        const ul = $('skipped-list');
        ul.innerHTML = '';
        for (const s of p.skipped) {
            const li = document.createElement('li');
            const detail = s.reason === 'custom' ? ` (${s.current} au lieu de ${s.proposed})` : '';
            li.textContent = `${s.date} · ${SKIP_LABELS[s.reason] ?? s.reason}${detail}`;
            ul.append(li);
        }
        $('skipped-details').hidden = p.skipped.length === 0;
        renderPlanGrid(p);
        log(`Simulation : ${p.ops.length} opérations, ${p.skipped.length} nuits ignorées`, 'ok');
    }

    /** Grille du plan : chaque nuit de l'année cible porte l'état qu'elle aura après application. */
    function renderPlanGrid(p) {
        const cells = {};
        const proposed = state.proposed ?? {};
        const describe = (date, label) => `${describeDate(date)} · ${label}`;
        for (const date of Object.keys(proposed)) {
            cells[date] = { state: 'unchanged', title: describe(date, `${proposed[date].price} € déjà en place`) };
        }
        const todayIso = today();
        for (const date of Object.keys(proposed)) {
            if (date < todayIso) {
                cells[date] = { state: 'past', title: describe(date, 'passée') };
            }
        }
        for (const s of p.skipped) {
            cells[s.date] = { state: s.reason, title: describe(s.date, `${SKIP_LABELS[s.reason] ?? s.reason}${s.reason === 'custom' ? `, ${s.current} € conservé` : ''}`) };
        }
        for (const op of p.ops) {
            for (const date of eachDay(op.from, op.to)) {
                cells[date] = { state: 'pending', title: describe(date, `${priceOf(op, date)} € à appliquer`) };
            }
        }
        state.planGrid = renderYearGrid($('plan-grid'), state.targetYear, cells, {
            legend: [
                { state: 'pending', label: 'à modifier' },
                { state: 'done', label: 'fait' },
                { state: 'unchanged', label: 'déjà au bon prix' },
                { state: 'custom', label: 'personnalisée' },
                { state: 'reserved', label: 'réservée' },
                { state: 'past', label: 'passée' },
            ],
        });
    }

    function priceOf(op, date) {
        return op.byWeekday ? op.byWeekday[WEEKDAY_NAMES[weekday(date)]] : op.price;
    }

    function markOp(op, stateName) {
        for (const date of eachDay(op.from, op.to)) {
            state.planGrid?.setState(date, stateName);
        }
    }

    async function apply() {
        const delay = Number($('delay').value) || 1500;
        const rows = $('plan-table').querySelectorAll('tbody tr');
        $('apply').disabled = true;
        $('plan').disabled = true;
        let done = 0;
        for (const [i, op] of state.plan.ops.entries()) {
            const cell = rows[i].querySelector('.state');
            cell.textContent = 'en cours';
            cell.className = 'state state-busy';
            markOp(op, 'busy');
            try {
                await adapter.applyPrice(op);
                cell.textContent = 'fait';
                cell.className = 'state state-done';
                markOp(op, 'done');
                done += 1;
            }
            catch (e) {
                cell.textContent = e.message;
                cell.className = 'state state-error';
                markOp(op, 'error');
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
        $('panel').classList.toggle('collapsed', collapsed);
        $('collapse').title = collapsed ? 'Déplier' : 'Réduire';
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
