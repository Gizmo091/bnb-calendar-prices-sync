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
    for (const id of ['export', 'plan']) {
        $(id).disabled = true;
    }
    setApply(false, 'Lisez ou importez des prix, puis prévisualisez');
    $('progress').hidden = true;
}

/** Barre de progression de l'application, en nuits traitées sur nuits à modifier. */
function setProgress(doneNights, totalNights, { failed = false } = {}) {
    const el = $('progress');
    const percent = totalNights ? Math.round((doneNights / totalNights) * 100) : 0;
    el.hidden = false;
    el.classList.toggle('failed', failed);
    el.setAttribute('aria-valuenow', String(percent));
    el.querySelector('.track i').style.setProperty('--w', `${percent}%`);
    el.querySelector('.count').textContent = `${doneNights}/${totalNights} nuits`;
}

/** Active le bouton d'application, ou l'inactive en disant pourquoi. */
function setApply(enabled, reason = '') {
    $('apply').disabled = !enabled;
    $('apply-hint').textContent = enabled ? '' : reason;
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
    setApply(false, 'Prévisualisez d\'abord');
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
        ...(seen.has('reserved') ? [{ flags: ['reserved'], label: 'réservée' }] : []),
        ...(seen.has('blocked') ? [{ flags: ['blocked'], label: 'bloquée' }] : []),
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
        log('Renseignez le prix de base avant de prévisualiser', 'error');
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
        const specialDays = readSpecialDays();
        state.rules = inferRules(state.days, labelYear(state.year, ctxSource, { specialDays }));
        renderRules(state.rules);
        const factor = readFactor();
        if (factor === null) {
            return false;
        }
        const rounding = Number($('rounding').value) || 1;
        state.proposed = scalePrices(generateYear(targetYear, state.rules, ctxTarget, basePrice, { specialDays }), factor, rounding);
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
    const factor = readFactor();
    if (factor === null) {
        return false;
    }
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

/** Numéros des jours cochés comme ayant un tarif propre (0 = dimanche). */
function readSpecialDays() {
    return [...$('special-days').querySelectorAll('input:checked')].map((input) => Number(input.value));
}

/* ---------- Réglages persistants ---------- */

const SETTINGS_KEY = 'settings';

async function saveSettings() {
    await chrome.storage.local.set({
        [SETTINGS_KEY]: {
            factor: $('factor').value,
            rounding: $('rounding').value,
            specialDays: readSpecialDays(),
            delay: $('delay').value,
        },
    });
}

async function restoreSettings() {
    const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (!saved) {
        return;
    }
    if (saved.factor !== undefined) {
        $('factor').value = saved.factor;
    }
    if (saved.rounding !== undefined) {
        $('rounding').value = saved.rounding;
    }
    if (Array.isArray(saved.specialDays)) {
        for (const input of $('special-days').querySelectorAll('input')) {
            input.checked = saved.specialDays.includes(Number(input.value));
        }
    }
    if (saved.delay !== undefined) {
        $('delay').value = saved.delay;
    }
}

/** Coefficient saisi avec une virgule ou un point ; null et message si la saisie n'est pas un nombre positif. */
function readFactor() {
    const raw = $('factor').value.trim().replace(',', '.');
    const factor = raw === '' ? 1 : Number(raw);
    if (!Number.isFinite(factor) || factor <= 0) {
        log(`Coefficient invalide : « ${$('factor').value} », attendu un nombre comme 1,05`, 'error');
        return null;
    }
    return factor;
}

/** Projette ou reprend les prix selon le mode choisi, puis compare au calendrier cible. */
async function simulate() {
    $('plan').disabled = true;
    setApply(false, 'Prévisualisation en cours');
    let ready = false;
    try {
        ready = $('mode').value === 'project' ? await project() : useAsIs();
        if (ready) {
            await plan();
        }
    }
    finally {
        $('plan').disabled = false;
        if (!ready) {
            setApply(false, 'La prévisualisation a échoué, voir le journal');
        }
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

/** Les douze mois de l'année, en bornes ISO. */
function monthRanges(year) {
    return Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1).padStart(2, '0');
        const last = new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
        return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(last).padStart(2, '0')}` };
    });
}

/**
 * Compare le calendrier cible aux prix proposés. La grille est affichée tout
 * de suite, chaque nuit en attente, puis se remplit mois par mois au fil de
 * la lecture du site : c'est elle qui fait office de progression.
 */
async function plan() {
    const basePrice = Number($('base-price').value);
    const overwrite = $('overwrite').checked;
    const year = state.targetYear;
    const months = monthRanges(year);
    state.current = {};
    const grid = renderPlanGrid(null);
    const reveal = revealQueue();
    log(`Lecture des prix actuels de ${year} pour comparaison…`);
    for (const [i, range] of months.entries()) {
        $('plan-summary').textContent = `Lecture des prix de ${year} · ${i}/${months.length} mois`;
        let chunk;
        let failed = false;
        try {
            chunk = await callAdapter('readCalendar', range);
        }
        catch (e) {
            log(`${e.message} — prévisualisation faite en supposant les nuits restantes au prix de base`, 'error');
            chunk = Object.fromEntries(eachDay(range.from, months[months.length - 1].to).map((d) => [d, { price: basePrice, custom: false }]));
            failed = true;
        }
        Object.assign(state.current, chunk);
        for (const date of Object.keys(chunk).sort()) {
            const next = state.proposed[date];
            if (next) {
                grid.update(date, planCell(date, chunk[date], next, provisionalReason(chunk[date], next, { basePrice, overwrite })), { delay: reveal() });
            }
        }
        await reveal.settled();
        if (failed) {
            break;
        }
    }
    state.plan = planUpdates(state.current, state.proposed, {
        basePrice,
        overwriteCustom: overwrite,
        weekdayPattern: site?.supportsWeekdayPattern === true,
        notBefore: today(),
    });
    renderPlan(state.plan);
    $('progress').hidden = true;
    if (state.plan.ops.length) {
        setApply(true);
    }
    else if (state.plan.skipped.length) {
        setApply(false, 'Rien à modifier : les nuits restantes sont réservées ou personnalisées');
    }
    else {
        setApply(false, 'Rien à modifier : toutes les nuits sont déjà au bon prix');
    }
}

const REVEAL_STEP_MS = 14;

/**
 * File de révélation : chaque appel réserve le créneau suivant, à partir de
 * maintenant ou de la fin du précédent, pour que les cases se dévoilent une à
 * une sans à-coup d'un mois à l'autre. `settled()` attend la fin de la file.
 */
function revealQueue() {
    let cursor = performance.now();
    const next = () => {
        cursor = Math.max(cursor, performance.now()) + REVEAL_STEP_MS;
        return cursor - performance.now();
    };
    next.settled = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, cursor - performance.now())));
    return next;
}

/** Raison d'ignorer une nuit, estimée avant le plan définitif avec les mêmes règles. */
function provisionalReason(cur, next, { basePrice, overwrite }) {
    if (!cur || typeof cur.price !== 'number') {
        return 'unknown';
    }
    if (cur.reserved) {
        return 'reserved';
    }
    const isCustom = typeof cur.custom === 'boolean' ? cur.custom : cur.price !== basePrice;
    return isCustom && !overwrite && cur.price !== next.price ? 'custom' : null;
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
    log(`Prévisualisation : ${p.ops.length} opérations, ${p.skipped.length} nuits ignorées`, 'ok');
}

/** Apparence d'une nuit du plan : bon prix, prix différent ou personnalisée, avec réservée et passée par-dessus. */
function planCell(date, cur, next, reason) {
    const flags = [];
    if (cur?.reserved) {
        flags.push('reserved');
    }
    if (date < today()) {
        flags.push('past');
    }
    if (!cur || typeof cur.price !== 'number') {
        return { state: 'unknown', flags, title: `${describeDate(date)} · absente du calendrier` };
    }
    const same = cur.price === next.price;
    const custom = reason === 'custom';
    const notes = [];
    if (!same) {
        notes.push(custom ? 'personnalisée, conservée' : flags.includes('reserved') ? 'réservée, conservée' : flags.includes('past') ? 'passée' : 'à modifier');
    }
    else if (flags.includes('reserved')) {
        notes.push('réservée');
    }
    return {
        state: same ? 'ok' : custom ? 'custom' : 'diff',
        flags,
        title: `${describeDate(date)} · ${cur.price} €${same ? '' : ` → ${next.price} €`}${notes.length ? ` · ${notes.join(', ')}` : ''}`,
    };
}

/**
 * Grille du plan : chaque nuit de l'année cible est au bon prix ou à un prix
 * différent ; réservée ou passée s'ajoutent par-dessus. Sans plan (`null`),
 * toutes les nuits sont en attente de lecture. À l'application, les nuits
 * modifiées passent au bon prix.
 */
function renderPlanGrid(p) {
    const cells = {};
    const proposed = state.proposed ?? {};
    const current = state.current ?? {};
    const skipped = new Map((p?.skipped ?? []).map((s) => [s.date, s.reason]));
    for (const [date, next] of Object.entries(proposed)) {
        cells[date] = p
            ? planCell(date, current[date], next, skipped.get(date))
            : { state: 'pending', title: `${describeDate(date)} · lecture en cours` };
    }
    state.planGrid = renderYearGrid($('plan-grid'), state.targetYear, cells, {
        legend: [
            { state: 'ok', label: 'bon prix' },
            { state: 'diff', label: 'à modifier' },
            { state: 'custom', label: 'personnalisée, conservée' },
            { flags: ['reserved'], label: 'réservée' },
            { state: 'ok', flags: ['past'], label: 'passée' },
        ],
    });
    return state.planGrid;
}

function markOp(op, stateName) {
    for (const date of eachDay(op.from, op.to)) {
        state.planGrid?.setState(date, stateName);
    }
}

async function apply() {
    const delay = Number($('delay').value) || 1500;
    const ops = state.plan.ops;
    setApply(false, 'Application en cours');
    $('plan').disabled = true;
    applying = true;
    const totalNights = ops.reduce((sum, op) => sum + op.nights, 0);
    let done = 0;
    let doneNights = 0;
    let failed = false;
    setProgress(0, totalNights);
    try {
        for (const op of ops) {
            $('plan-summary').textContent = `Enregistrement en cours : ${describeOp(op)} du ${op.from} au ${op.to}`;
            markOp(op, 'busy');
            try {
                await callAdapter('applyPrice', op);
                markOp(op, 'ok');
                done += 1;
                doneNights += op.nights;
                setProgress(doneNights, totalNights);
            }
            catch (e) {
                markOp(op, 'error');
                failed = true;
                setProgress(doneNights, totalNights, { failed: true });
                log(`Arrêt : ${e.message}`, 'error');
                break;
            }
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    finally {
        applying = false;
    }
    const complete = done === ops.length && !failed;
    $('plan-summary').textContent = complete
        ? `${done} opérations enregistrées, ${state.plan.changed} nuits au bon prix`
        : `Enregistrement interrompu après ${done}/${ops.length} opérations, voir le journal`;
    log(`${done}/${ops.length} opérations appliquées`, complete ? 'ok' : 'error');
    $('plan').disabled = false;
    setApply(false, complete ? 'Enregistré, prévisualisez à nouveau pour vérifier' : 'Interrompu, prévisualisez à nouveau pour reprendre');
}

/* ---------- Câblage ---------- */

$('year').addEventListener('change', () => { $('target-year').value = Number($('year').value) + 1; syncMode(); });
$('base-price').addEventListener('change', persist);
$('read').addEventListener('click', readCalendar);
$('export').addEventListener('click', exportJson);
$('import').addEventListener('change', (e) => e.target.files[0] && importJson(e.target.files[0]));
$('mode').addEventListener('change', syncMode);
for (const id of ['factor', 'rounding', 'special-days', 'delay']) {
    $(id).addEventListener('change', saveSettings);
}
await restoreSettings();
document.addEventListener('click', (e) => {
    const settings = $('settings');
    if (settings.open && !settings.contains(e.target)) {
        settings.open = false;
    }
});
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
