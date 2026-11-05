/**
 * Panneau latéral de Chrome. Enchaînement : lire ou importer les prix →
 * confirmer le prix de base → projeter sur l'année suivante → simuler → appliquer.
 *
 * Le panneau est lié à l'onglet actif au moment de son ouverture et suit les
 * changements d'onglet tant qu'aucune application n'est en cours. La page est
 * pilotée par messages vers le script de contenu, qui porte l'adaptateur.
 * Les appels aux API publiques passent par le service worker (cache).
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

/** Fenêtre lue sur le site pour trouver le prix de base : au-delà de l'horizon de réservation. */
const FAR_FROM_MONTHS = 18;
const FAR_TO_MONTHS = 24;
const CONFIDENT_SHARE = 0.9;
const BIND_ATTEMPTS = 4;
const BIND_RETRY_MS = 500;

/** Les fichiers de prix sont du JSON, sous une extension propre à l'extension pour être reconnus. */
const FILE_EXTENSION = '.bnbprices';

const SKIP_LABELS = {
    custom: 'déjà personnalisée',
    reserved: 'réservée',
    unknown: 'absente du calendrier',
};

const html = await (await fetch(new URL('template.html', import.meta.url))).text();
document.body.innerHTML = html;
const $ = (id) => document.getElementById(id);

/* ---------- Liaison à l'onglet ---------- */

let boundTab = null;
let site = null;
let applying = false;
let storageKey = null;
let state = null;

async function callAdapter(method, ...args) {
    if (boundTab === null) {
        throw new Error('Aucun onglet lié au panneau');
    }
    let response;
    try {
        response = await chrome.tabs.sendMessage(boundTab, { target: 'adapter', method, args });
    }
    catch {
        throw new Error('La page ne répond pas : ouvrez un calendrier Airbnb ou Abritel, ou rechargez l\'onglet');
    }
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Erreur inconnue dans la page');
    }
    return response.result;
}

async function callBackground(action, params = {}) {
    const response = await chrome.runtime.sendMessage({ target: 'background', action, ...params });
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Pas de réponse du service worker');
    }
    return response.result;
}

/** Lie le panneau à un onglet : interroge la page, puis restaure l'état de l'annonce. */
async function bind(tabId) {
    boundTab = tabId;
    let info = null;
    // Juste après un chargement, le script de contenu peut ne pas être encore en place.
    for (let attempt = 0; attempt < BIND_ATTEMPTS && !info; attempt++) {
        if (attempt) {
            await new Promise((r) => setTimeout(r, BIND_RETRY_MS));
        }
        if (boundTab !== tabId) {
            return;
        }
        info = await callAdapter('info').catch(() => null);
    }
    site = info;
    resetUi();
    if (!info) {
        $('unsupported').hidden = false;
        $('steps').hidden = true;
        $('site-info').textContent = '';
        return;
    }
    $('unsupported').hidden = true;
    $('steps').hidden = false;
    storageKey = `panelState:${info.site}:${info.listingId ?? 'unknown'}`;
    state = {
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
    $('site-info').textContent = `${info.label}${info.listingId ? ` · annonce ${info.listingId}` : ''}${info.calibrated ? '' : ' · adaptateur non calibré'}`;
    if (!info.listingId) {
        $('notice').innerHTML = `Cette page n'est pas le calendrier d'une annonce. Ouvrez-le pour lire ou modifier les prix : <code>${info.calendarUrl ?? ''}</code>`;
        $('notice').hidden = false;
        $('read').disabled = true;
    }
    log(`Onglet lié : ${info.label}${info.listingId ? ` · annonce ${info.listingId}` : ''}`);

    const saved = (await chrome.storage.local.get(storageKey))[storageKey];
    if (saved?.days) {
        if (saved.basePrice) {
            $('base-price').value = saved.basePrice;
        }
        if (saved.targetYear) {
            $('target-year').value = saved.targetYear;
        }
        setDays(saved.days, saved.year, 'conservées de la session précédente');
    }
}

function resetUi() {
    const currentYear = yearOf(today());
    syncMode();
    $('year').value = currentYear;
    $('target-year').value = currentYear + 1;
    $('base-price').value = '';
    $('notice').hidden = true;
    $('read').disabled = false;
    $('read-summary').textContent = '';
    $('read-grid').hidden = true;
    $('read-result').hidden = true;
    $('base-hint').textContent = '';
    $('rules-details').hidden = true;
    $('plan-summary').textContent = '';
    $('plan-grid').hidden = true;
    $('plan-table').hidden = true;
    $('skipped-details').hidden = true;
    for (const id of ['export', 'plan', 'apply']) {
        $(id).disabled = true;
    }
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

async function persist() {
    if (!storageKey) {
        return;
    }
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
    $('read-summary').textContent = `${count} nuits de ${year} ${origin}`;
    $('read-result').hidden = false;
    syncMode();
    renderDays(days, year);
    $('export').disabled = count === 0;
    $('plan').disabled = count === 0;
    $('apply').disabled = true;
    suggestBasePrice(days, year);
    log(`${count} nuits de ${year} ${origin}`, 'ok');
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
            state: day.reserved ? 'reserved' : day.available === false ? 'blocked' : undefined,
            title: `${describeDate(date)} · ${price}${flags.length ? ` · ${flags.join(', ')}` : ''}`,
        };
    }
    const states = new Set(Object.values(cells).map((c) => c.state));
    const legend = min === undefined ? [] : [
        { level: 1, label: `${min} €` },
        { level: 5, label: `${max} €` },
        ...(states.has('reserved') ? [{ state: 'reserved', label: 'réservée' }] : []),
        ...(states.has('blocked') ? [{ state: 'blocked', label: 'bloquée' }] : []),
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
    let confident = null;
    const farFrom = addMonths(today(), FAR_FROM_MONTHS);
    const farTo = addMonths(today(), FAR_TO_MONTHS);
    try {
        const farDays = await callAdapter('readCalendar', { from: farFrom, to: farTo });
        const far = detectBasePrice(farDays, { horizonMonths: 0, from: farFrom });
        if (far.price !== null) {
            log(`Prix de base : ${far.price} € sur ${far.samples} nuits de fin de calendrier (${Math.round(far.share * 100)} %)`);
            if (far.share >= CONFIDENT_SHARE) {
                confident = far.price;
            }
        }
    }
    catch (e) {
        log(`Fin de calendrier illisible (${e.message}), prix de base estimé sur les nuits chargées`, 'error');
    }
    const fromSite = site?.hasBasePrice ? await callAdapter('basePrice').catch(() => null) : null;
    const loaded = detectBasePrice(days, { horizonMonths: 0, from: `${year}-01-01` });
    const suggested = confident ?? fromSite ?? loaded.price;
    if (confident !== null || (suggested !== null && !$('base-price').value)) {
        $('base-price').value = suggested;
    }
    if (confident !== null) {
        $('base-hint').textContent = `Détecté : ${confident} €`;
    }
    else if (suggested !== null) {
        $('base-hint').textContent = `Estimé : ${suggested} €, à vérifier`;
    }
    else {
        $('base-hint').textContent = 'Prix de base introuvable, à saisir';
    }
    persist();
}

async function readCalendar() {
    const year = Number($('year').value);
    const { from, to } = yearBounds(year);
    log(`Lecture du calendrier du ${from} au ${to}…`);
    try {
        const days = await callAdapter('readCalendar', { from, to });
        setDays(days, year, 'lues sur le site, lecture terminée');
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
    a.download = `prix-${doc.site}-${state.year}${FILE_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
    log(`Export ${a.download}`, 'ok');
}

async function importJson(file) {
    try {
        const doc = JSON.parse(await file.text());
        const errors = validateExport(doc);
        if (errors.length) {
            throw new Error(`Ce fichier n'est pas un fichier de prix de l'extension : ${errors.join(' ; ')}`);
        }
        const years = new Set(Object.keys(doc.days).map(yearOf));
        const year = years.size === 1 ? [...years][0] : Number($('year').value);
        if (doc.basePrice) {
            $('base-price').value = doc.basePrice;
        }
        $('target-year').value = year + 1;
        setDays(doc.days, year, `importées de ${file.name}`);
    }
    catch (e) {
        log(e.message, 'error');
    }
}

/* ---------- 2 et 3. Règles et projection ---------- */

async function project() {
    const basePrice = Number($('base-price').value);
    if (!basePrice) {
        log('Renseignez le prix de base avant de simuler', 'error');
        return false;
    }
    const targetYear = Number($('target-year').value);
    try {
        log(`Chargement des vacances scolaires et jours fériés ${state.year} et ${targetYear}…`);
        const [ctxSource, ctxTarget] = await Promise.all([
            callBackground('calendarContext', { year: state.year }),
            callBackground('calendarContext', { year: targetYear }),
        ]);
        if (!ctxTarget.schoolPeriods.some((p) => p.start.startsWith(String(targetYear)) && p.season === 'noel')) {
            log(`Attention : les vacances de Noël ${targetYear} ne sont pas encore publiées, décembre retombera sur le hors-saison`, 'error');
        }
        state.rules = inferRules(state.days, labelYear(state.year, ctxSource));
        renderRules(state.rules);
        const factor = Number($('factor').value) || 1;
        const rounding = Number($('rounding').value) || 1;
        state.proposed = scalePrices(generateYear(targetYear, state.rules, ctxTarget, basePrice), factor, rounding);
        state.targetYear = targetYear;
        log(`${Object.keys(state.rules).length} règles déduites, ${Object.keys(state.proposed).length} nuits projetées sur ${targetYear}`, 'ok');
        persist();
        return true;
    }
    catch (e) {
        log(e.message, 'error');
        return false;
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
    persist();
    return true;
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
}

/* ---------- 4. Simulation et application ---------- */

/** Projette ou reprend les prix selon le mode choisi, puis compare au calendrier cible. */
async function simulate() {
    $('plan').disabled = true;
    $('apply').disabled = true;
    try {
        const ready = $('mode').value === 'project' ? await project() : useAsIs();
        if (ready) {
            await plan();
        }
    }
    finally {
        $('plan').disabled = false;
    }
}

/** Libellés du mode avec les années concernées, et champ « Vers » seulement pour un report. */
function syncMode() {
    const year = state?.year ?? Number($('year').value);
    const [project, asIs] = $('mode').options;
    project.textContent = `Reporter les tarifs de ${year} sur une autre année`;
    asIs.textContent = `Reprendre les tarifs tels quels sur ${year}`;
    $('target-year-field').hidden = $('mode').value !== 'project';
}

async function plan() {
    const basePrice = Number($('base-price').value);
    const { from, to } = yearBounds(state.targetYear);
    log(`Lecture des prix actuels de ${state.targetYear} pour comparaison…`);
    let current;
    try {
        current = await callAdapter('readCalendar', { from, to });
    }
    catch (e) {
        log(`${e.message} — simulation faite en supposant toutes les nuits au prix de base`, 'error');
        current = Object.fromEntries(Object.keys(state.proposed).map((d) => [d, { price: basePrice, custom: false }]));
    }
    state.current = current;
    state.plan = planUpdates(current, state.proposed, {
        basePrice,
        overwriteCustom: $('overwrite').checked,
        weekdayPattern: site?.supportsWeekdayPattern === true,
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
        tr.innerHTML = `<td class="date"><span>du</span> ${op.from}<br><span>au</span> ${op.to}</td><td class="num">${op.nights}</td><td class="num">${formatOp(op)}</td><td class="state">en attente</td>`;
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
    const todayIso = today();
    const current = state.current ?? {};
    for (const date of Object.keys(proposed)) {
        if (date < todayIso) {
            cells[date] = { state: 'past', title: describe(date, 'passée') };
        }
        else if (current[date]?.reserved) {
            cells[date] = { state: 'reserved', title: describe(date, `réservée, ${current[date].price} € conservé`) };
        }
        else {
            cells[date] = { state: 'unchanged', title: describe(date, `${proposed[date].price} € déjà en place`) };
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

/** Prix d'une opération sur une ligne par motif, le groupe majoritaire de jours étant nommé « autres ». */
function formatOp(op) {
    return describeOp(op).split(' · ').map((part) => {
        const [days, price] = part.split(' ');
        if (price === undefined) {
            return part;
        }
        return `<span class="days">${days.split('/').length >= 4 ? 'autres' : days}</span> ${price}`;
    }).join('<br>');
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
    applying = true;
    let done = 0;
    try {
        for (const [i, op] of state.plan.ops.entries()) {
            const cell = rows[i].querySelector('.state');
            cell.textContent = 'en cours';
            cell.className = 'state state-busy';
            markOp(op, 'busy');
            try {
                await callAdapter('applyPrice', op);
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
    }
    finally {
        applying = false;
    }
    log(`${done}/${state.plan.ops.length} opérations appliquées`, done === state.plan.ops.length ? 'ok' : 'error');
    $('plan').disabled = false;
}

/* ---------- Câblage ---------- */

$('year').addEventListener('change', () => { $('target-year').value = Number($('year').value) + 1; syncMode(); });
$('base-price').addEventListener('change', persist);
$('read').addEventListener('click', readCalendar);
$('export').addEventListener('click', exportJson);
$('import').addEventListener('change', (e) => e.target.files[0] && importJson(e.target.files[0]));
$('mode').addEventListener('change', syncMode);
$('plan').addEventListener('click', simulate);
$('apply').addEventListener('click', apply);

chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (!applying && tabId !== boundTab) {
        bind(tabId);
    }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (!applying && tabId === boundTab && change.status === 'complete') {
        bind(tabId);
    }
});

const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
if (active) {
    await bind(active.id);
}
else {
    resetUi();
    $('unsupported').hidden = false;
    $('steps').hidden = true;
}
