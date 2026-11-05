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
    describeOp, eachDay,
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
            flags: day.reserved ? ['reserved'] : day.available === false ? ['blocked'] : [],
            title: `${describeDate(date)} · ${price}${flags.length ? ` · ${flags.join(', ')}` : ''}`,
        };
    }
    const seen = new Set(Object.values(cells).flatMap((c) => c.flags));
    const legend = min === undefined ? [] : [
        { level: 1, label: `${min} €` },
        { level: 5, label: `${max} €` },
        ...(seen.has('reserved') ? [{ level: 3, flags: ['reserved'], label: 'réservée' }] : []),
        ...(seen.has('blocked') ? [{ level: 3, flags: ['blocked'], label: 'bloquée' }] : []),
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

/**
 * Grille du plan : chaque nuit de l'année cible est au bon prix ou à un prix
 * différent ; réservée ou passée s'ajoutent par-dessus. À l'application, les
 * nuits modifiées passent au bon prix.
 */
function renderPlanGrid(p) {
    const cells = {};
    const proposed = state.proposed ?? {};
    const current = state.current ?? {};
    const todayIso = today();
    const skipped = new Map(p.skipped.map((s) => [s.date, s.reason]));
    for (const [date, next] of Object.entries(proposed)) {
        const cur = current[date];
        const flags = [];
        if (cur?.reserved) {
            flags.push('reserved');
        }
        if (date < todayIso) {
            flags.push('past');
        }
        if (!cur || typeof cur.price !== 'number') {
            cells[date] = { state: 'unknown', flags, title: `${describeDate(date)} · absente du calendrier` };
            continue;
        }
        const same = cur.price === next.price;
        const notes = [];
        if (!same) {
            notes.push(skipped.get(date) === 'custom' ? 'personnalisée, conservée' : flags.includes('reserved') ? 'réservée, conservée' : flags.includes('past') ? 'passée' : 'à modifier');
        }
        else if (flags.includes('reserved')) {
            notes.push('réservée');
        }
        cells[date] = {
            state: same ? 'ok' : 'diff',
            flags,
            title: `${describeDate(date)} · ${cur.price} €${same ? '' : ` → ${next.price} €`}${notes.length ? ` · ${notes.join(', ')}` : ''}`,
        };
    }
    state.planGrid = renderYearGrid($('plan-grid'), state.targetYear, cells, {
        legend: [
            { state: 'ok', label: 'bon prix' },
            { state: 'diff', label: 'prix différent' },
            { state: 'ok', flags: ['reserved'], label: 'réservée' },
            { state: 'ok', flags: ['past'], label: 'passée' },
        ],
    });
}


function markOp(op, stateName) {
    for (const date of eachDay(op.from, op.to)) {
        state.planGrid?.setState(date, stateName);
    }
}

async function apply() {
    const delay = Number($('delay').value) || 1500;
    const ops = state.plan.ops;
    $('apply').disabled = true;
    $('plan').disabled = true;
    applying = true;
    let done = 0;
    try {
        for (const op of ops) {
            $('plan-summary').textContent = `Application en cours : ${done}/${ops.length} opérations, ${describeOp(op)} du ${op.from} au ${op.to}`;
            markOp(op, 'busy');
            try {
                await callAdapter('applyPrice', op);
                markOp(op, 'ok');
                done += 1;
            }
            catch (e) {
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
    const complete = done === ops.length;
    $('plan-summary').textContent = complete
        ? `${done} opérations appliquées, ${state.plan.changed} nuits au bon prix`
        : `Application interrompue après ${done}/${ops.length} opérations, voir le journal`;
    log(`${done}/${ops.length} opérations appliquées`, complete ? 'ok' : 'error');
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
