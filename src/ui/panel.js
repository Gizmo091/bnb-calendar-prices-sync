/**
 * Panneau latéral de Chrome. Enchaînement : lire ou importer les prix →
 * confirmer le prix de base → projeter sur l'année suivante → simuler →
 * appliquer, tout ou seulement les nuits choisies sur la grille.
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
    detectBasePrice, planUpdates, opsForDates,
    createExport, validateExport, scalePrices, exportFileName,
    describeOp, eachDay, t, translateDom, useLanguage,
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

const SKIP_LABELS = { custom: 'skip_custom', reserved: 'skip_reserved', unknown: 'skip_unknown' };

const html = await (await fetch(new URL('template.html', import.meta.url))).text();
document.body.innerHTML = html;
translateDom(document.body);
document.title = t('ext_name');
const $ = (id) => document.getElementById(id);

/* ---------- Liaison à l'onglet ---------- */

let boundTab = null;
let site = null;
let applying = false;
let storageKey = null;
let state = null;

async function callAdapter(method, ...args) {
    if (boundTab === null) {
        throw new Error(t('err_no_tab'));
    }
    let response;
    try {
        response = await chrome.tabs.sendMessage(boundTab, { target: 'adapter', method, args, lang: $('language').value });
    }
    catch {
        throw new Error(t('err_page_unresponsive'));
    }
    if (!response?.ok) {
        throw new Error(response?.error ?? t('err_page_unknown'));
    }
    return response.result;
}

async function callBackground(action, params = {}) {
    const response = await chrome.runtime.sendMessage({ target: 'background', action, ...params });
    if (!response?.ok) {
        throw new Error(response?.error ?? t('err_no_worker'));
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
        listingName: info.name ?? null,
        year: null,
        days: null,
        rules: null,
        proposed: null,
        targetYear: null,
        plan: null,
        planGrid: null,
        applied: null,
    };
    showSiteInfo();
    if (info.listingId && !info.name) {
        watchListingName(tabId);
    }
    if (!info.listingId) {
        const code = document.createElement('code');
        code.textContent = info.calendarUrl ?? '';
        $('notice').replaceChildren(t('notice_not_calendar'), code);
        $('notice').hidden = false;
        $('read').disabled = true;
    }
    log(t('log_bound', `${site.label}${describeListing(info.listingId, info.name) ? ` · ${describeListing(info.listingId, info.name)}` : ''}`));

    // Les prix conservés ne reviennent que sur l'annonce où ils ont été chargés.
    const saved = info.listingId ? (await chrome.storage.local.get(storageKey))[storageKey] : null;
    if (saved?.days && saved.site === info.site && saved.listingId === info.listingId) {
        if (saved.basePrice) {
            $('base-price').value = saved.basePrice;
        }
        if (saved.targetYear) {
            $('target-year').value = saved.targetYear;
        }
        setDays(saved.days, saved.year, t('origin_restored'));
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
    $('read-notice').hidden = true;
    lockSteps(true);
    $('base-hint').textContent = '';
    $('rules-details').hidden = true;
    $('plan-summary').textContent = '';
    $('plan-grid').hidden = true;
    $('skipped-details').hidden = true;
    for (const id of ['export', 'plan']) {
        $(id).disabled = true;
    }
    setApply(false, t('hint_read_first'));
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
    el.querySelector('.count').textContent = t('progress_nights', doneNights, totalNights);
}

/** Active les boutons d'application, ou les inactive en disant pourquoi. */
function setApply(enabled, reason = '') {
    $('apply').disabled = !enabled;
    $('apply-hint').textContent = enabled ? t('hint_select') : reason;
    syncSelectionButton();
}

/** Le bouton de la sélection suit le bouton principal et le nombre de nuits choisies. */
function syncSelectionButton() {
    const count = state?.planGrid?.selected().length ?? 0;
    $('apply-selection').disabled = $('apply').disabled || count === 0;
    $('apply-selection').textContent = count > 1 ? t('btn_apply_selection_count', count) : count === 1 ? t('btn_apply_selection_one') : t('btn_apply_selection');
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
    if (!storageKey || !state?.listingId) {
        return;
    }
    await chrome.storage.local.set({
        [storageKey]: {
            site: state.site,
            listingId: state.listingId,
            year: state.year,
            days: state.days,
            basePrice: Number($('base-price').value) || null,
            targetYear: Number($('target-year').value) || null,
        },
    });
}

/** Les étapes à partir du prix de base n'ont de sens qu'avec des prix chargés. */
function lockSteps(locked) {
    $('after-read').classList.toggle('locked', locked);
    $('after-read').inert = locked;
}

const SITE_LABELS = { airbnb: 'Airbnb', abritel: 'Abritel' };
const NAME_RETRY_MS = [1000, 2000, 4000, 8000];

function showSiteInfo() {
    const listing = describeListing(state?.listingId, state?.listingName);
    $('site-info').textContent = `${site.label}${listing ? ` · ${listing}` : ''}${site.calibrated ? '' : t('site_uncalibrated')}`;
    $('site-info').title = $('site-info').textContent;
}

/**
 * Le nom de l'annonce arrive parfois après la liaison, quand le site finit
 * d'écrire son titre : on redemande quelques fois, tant que l'onglet lié
 * est le même.
 */
async function refreshListingName() {
    const info = await callAdapter('info').catch(() => null);
    if (info?.name && info.listingId === state?.listingId) {
        state.listingName = info.name;
        showSiteInfo();
        return true;
    }
    return false;
}

async function watchListingName(tabId) {
    for (const delay of NAME_RETRY_MS) {
        await new Promise((r) => setTimeout(r, delay));
        if (boundTab !== tabId || state?.listingName) {
            return;
        }
        if (await refreshListingName()) {
            return;
        }
    }
}

/** « Nom de l'annonce » ou « annonce 123 », selon ce que le site a donné. */
function describeListing(listingId, name) {
    if (name) {
        return name;
    }
    return listingId ? t('listing_id', listingId) : '';
}

/* ---------- 1. Lecture, export, import ---------- */

function setDays(days, year, origin) {
    state.days = days;
    state.year = year;
    $('year').value = year;
    const count = Object.keys(days).length;
    $('read-summary').textContent = t('days_summary', count, year, origin);
    lockSteps(count === 0);
    $('read-result').hidden = false;
    syncMode();
    renderDays(days, year);
    $('export').disabled = count === 0;
    $('plan').disabled = count === 0;
    setApply(false, t('hint_plan_first'));
    suggestBasePrice(days, year);
    log(t('days_summary', count, year, origin), 'ok');
    persist();
}

/** Apparence d'une nuit chargée : un palier d'accent par niveau de prix, réservée ou bloquée par-dessus. */
function dayCell(date, day, levels) {
    const price = typeof day.price === 'number' ? `${day.price} €` : t('price_unknown');
    const notes = [day.reserved ? t('note_reserved') : '', day.available === false ? t('note_blocked') : '', day.promotion ? t('note_promotion') : ''].filter(Boolean);
    return {
        level: levels[date],
        flags: day.reserved ? ['reserved'] : day.available === false ? ['blocked'] : [],
        title: `${describeDate(date)} · ${price}${notes.length ? ` · ${notes.join(', ')}` : ''}`,
    };
}

/** Grille de l'année chargée, avec sa légende. */
function renderDays(days, year) {
    const { levels, min, max } = priceLevels(days);
    const cells = {};
    for (const [date, day] of Object.entries(days)) {
        cells[date] = dayCell(date, day, levels);
    }
    const seen = new Set(Object.values(cells).flatMap((c) => c.flags));
    const legend = min === undefined ? [] : [
        { scale: [min, max] },
        ...(seen.has('reserved') ? [{ flags: ['reserved'], label: t('note_reserved') }] : []),
        ...(seen.has('blocked') ? [{ flags: ['blocked'], label: t('note_blocked') }] : []),
    ];
    renderYearGrid($('read-grid'), year, cells, { legend });
}

/** Grille de l'année en attente de lecture, affichée dans l'encart des prix chargés. */
function pendingReadGrid(year) {
    const { from, to } = yearBounds(year);
    const cells = Object.fromEntries(eachDay(from, to).map((d) => [d, { state: 'pending', title: `${describeDate(d)} · ${t('cell_waiting')}` }]));
    $('read-result').hidden = false;
    $('export').disabled = true;
    return renderYearGrid($('read-grid'), year, cells);
}

/**
 * Dévoile des nuits une à une dans la grille, avec les niveaux de prix connus
 * à cet instant ; la grille finale, rendue d'un bloc, fixera les nuances.
 */
async function revealDays(grid, days, dates, reveal) {
    const { levels } = priceLevels(days);
    for (const date of dates) {
        grid.update(date, dayCell(date, days[date], levels), { delay: reveal() });
    }
    await reveal.settled();
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
            log(t('log_base_far', far.price, far.samples, Math.round(far.share * 100)));
            if (far.share >= CONFIDENT_SHARE) {
                confident = far.price;
            }
        }
    }
    catch (e) {
        log(t('log_base_far_failed', e.message), 'error');
    }
    const fromSite = site?.hasBasePrice ? await callAdapter('basePrice').catch(() => null) : null;
    const loaded = detectBasePrice(days, { horizonMonths: 0, from: `${year}-01-01` });
    const suggested = confident ?? fromSite ?? loaded.price;
    if (confident !== null || (suggested !== null && !$('base-price').value)) {
        $('base-price').value = suggested;
    }
    if (confident !== null) {
        $('base-hint').textContent = t('base_detected', confident);
    }
    else if (suggested !== null) {
        $('base-hint').textContent = t('base_estimated', suggested);
    }
    else {
        $('base-hint').textContent = t('base_missing');
    }
    persist();
}

/** Lecture du site mois par mois, la grille se dévoilant au fil des réponses. */
async function readCalendar() {
    const year = Number($('year').value);
    const months = monthRanges(year);
    log(t('log_reading', year));
    $('read').disabled = true;
    try {
        const grid = pendingReadGrid(year);
        const reveal = revealQueue();
        const days = {};
        for (const [i, range] of months.entries()) {
            $('read-summary').textContent = t('reading_progress', year, i, months.length);
            grid.setState(range.from, 'next');
            const chunk = await callAdapter('readCalendar', range);
            Object.assign(days, chunk);
            await revealDays(grid, days, Object.keys(chunk).sort(), reveal);
        }
        setDays(days, year, t('origin_read'));
    }
    catch (e) {
        log(e.message, 'error');
        $('read-summary').textContent = t('read_failed');
    }
    finally {
        $('read').disabled = false;
    }
}

async function exportJson() {
    if (!state.listingName) {
        await refreshListingName();
    }
    const doc = createExport({
        site: state.site,
        listingId: state.listingId,
        listingName: state.listingName,
        basePrice: Number($('base-price').value) || null,
        days: state.days,
    });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName({ site: doc.site, listingId: doc.listingId, listingName: doc.listingName, year: state.year, extension: FILE_EXTENSION });
    a.click();
    URL.revokeObjectURL(url);
    log(t('log_export', a.download), 'ok');
}

async function importJson(file) {
    try {
        const doc = JSON.parse(await file.text());
        const errors = validateExport(doc);
        if (errors.length) {
            throw new Error(t('err_not_price_file', errors.join(' ; ')));
        }
        const years = new Set(Object.keys(doc.days).map(yearOf));
        const year = years.size === 1 ? [...years][0] : Number($('year').value);
        if (doc.basePrice) {
            $('base-price').value = doc.basePrice;
        }
        $('target-year').value = year + 1;
        const grid = pendingReadGrid(year);
        $('read-summary').textContent = t('loading_file', file.name);
        await revealDays(grid, doc.days, Object.keys(doc.days).sort(), revealQueue(IMPORT_REVEAL_STEP_MS));
        setDays(doc.days, year, t('origin_imported', file.name));
        // Un fichier d'une autre annonce est légitime (transfert entre sites), mais doit se voir.
        if (doc.listingId && (doc.site !== state.site || doc.listingId !== state.listingId)) {
            const origin = `${SITE_LABELS[doc.site] ?? doc.site} · ${describeListing(doc.listingId, doc.listingName)}`;
            $('read-notice').textContent = t('notice_other_listing', origin);
            $('read-notice').hidden = false;
            log(t('log_other_listing', origin), 'error');
        }
    }
    catch (e) {
        log(e.message, 'error');
    }
}

/* ---------- 2 et 3. Règles et projection ---------- */

async function project() {
    const basePrice = Number($('base-price').value);
    if (!basePrice) {
        log(t('err_base_required'), 'error');
        return false;
    }
    const targetYear = Number($('target-year').value);
    try {
        log(t('log_loading_calendar', state.year, targetYear));
        const [ctxSource, ctxTarget] = await Promise.all([
            callBackground('calendarContext', { year: state.year }),
            callBackground('calendarContext', { year: targetYear }),
        ]);
        if (!ctxTarget.schoolPeriods.some((p) => p.start.startsWith(String(targetYear)) && p.season === 'noel')) {
            log(t('log_no_christmas', targetYear), 'error');
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
        log(t('log_projected', Object.keys(state.rules).length, Object.keys(state.proposed).length, targetYear), 'ok');
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
    log(t('log_as_is', Object.keys(state.proposed).length, state.year, factor !== 1 ? t('factor_suffix', factor) : ''), 'ok');
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

/** Le journal reste tenu même masqué : il réapparaît tel quel. */
function syncLogVisibility() {
    $('journal').hidden = !$('show-log').checked;
}

const SETTINGS_KEY = 'settings';

async function saveSettings() {
    await chrome.storage.local.set({
        [SETTINGS_KEY]: {
            factor: $('factor').value,
            rounding: $('rounding').value,
            specialDays: readSpecialDays(),
            showLog: $('show-log').checked,
            language: $('language').value,
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
    if (typeof saved.showLog === 'boolean') {
        $('show-log').checked = saved.showLog;
    }
    syncLogVisibility();
    if (['auto', 'en', 'fr'].includes(saved.language)) {
        $('language').value = saved.language;
    }
    await applyLanguage();
}

/**
 * Applique la langue choisie aux textes fixes du panneau ; les textes déjà
 * écrits (journal, résumés) gardent leur langue jusqu'à la prochaine action.
 */
async function applyLanguage() {
    await useLanguage($('language').value);
    translateDom(document.body);
    document.title = t('ext_name');
    syncMode();
    syncSelectionButton();
    $('pause').textContent = t(run.paused ? 'btn_resume' : 'btn_pause');
}

/** Coefficient saisi avec une virgule ou un point ; null et message si la saisie n'est pas un nombre positif. */
function readFactor() {
    const raw = $('factor').value.trim().replace(',', '.');
    const factor = raw === '' ? 1 : Number(raw);
    if (!Number.isFinite(factor) || factor <= 0) {
        log(t('err_factor', $('factor').value), 'error');
        return null;
    }
    return factor;
}

/** Projette ou reprend les prix selon le mode choisi, puis compare au calendrier cible. */
async function simulate() {
    $('plan').disabled = true;
    setApply(false, t('hint_previewing'));
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
            setApply(false, t('hint_preview_failed'));
        }
    }
}

/** Libellés du mode avec les années concernées, et champ « Vers » seulement pour un report. */
function syncMode() {
    const year = state?.year ?? Number($('year').value);
    const [project, asIs] = $('mode').options;
    project.textContent = t('mode_project', year);
    asIs.textContent = t('mode_as_is', year);
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
    const { levels } = priceLevels(state.proposed);
    const reveal = revealQueue();
    log(t('log_reading_current', year));
    for (const [i, range] of months.entries()) {
        $('plan-summary').textContent = t('reading_progress', year, i, months.length);
        grid.setState(range.from, 'next');
        let chunk;
        let failed = false;
        try {
            chunk = await callAdapter('readCalendar', range);
        }
        catch (e) {
            log(t('log_read_fallback', e.message), 'error');
            chunk = Object.fromEntries(eachDay(range.from, months[months.length - 1].to).map((d) => [d, { price: basePrice, custom: false }]));
            failed = true;
        }
        Object.assign(state.current, chunk);
        for (const date of Object.keys(chunk).sort()) {
            const next = state.proposed[date];
            if (next) {
                grid.update(date, planCell(date, chunk[date], next, provisionalReason(chunk[date], next, { basePrice, overwrite }), { basePrice, level: levels[date] }), { delay: reveal() });
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
    state.applied = new Set();
    renderPlan(state.plan);
    $('progress').hidden = true;
    if (state.plan.ops.length) {
        setApply(true);
    }
    else if (state.plan.skipped.length) {
        setApply(false, t('hint_nothing_skipped'));
    }
    else {
        setApply(false, t('hint_nothing_ok'));
    }
}

const REVEAL_STEP_MS = 14;
const IMPORT_REVEAL_STEP_MS = 5;

/**
 * File de révélation : chaque appel réserve le créneau suivant, à partir de
 * maintenant ou de la fin du précédent, pour que les cases se dévoilent une à
 * une sans à-coup d'un mois à l'autre. `settled()` attend la fin de la file.
 */
function revealQueue(step = REVEAL_STEP_MS) {
    let cursor = performance.now();
    const next = () => {
        cursor = Math.max(cursor, performance.now()) + step;
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
    $('plan-summary').textContent = t('plan_summary', p.changed, p.ops.length, p.unchanged, p.skipped.length) + (p.past ? t('plan_summary_past', p.past) : '');
    const ul = $('skipped-list');
    ul.innerHTML = '';
    for (const s of p.skipped) {
        const li = document.createElement('li');
        const detail = s.reason === 'custom' ? t('skip_detail', s.current, s.proposed) : '';
        li.textContent = `${s.date} · ${SKIP_LABELS[s.reason] ? t(SKIP_LABELS[s.reason]) : s.reason}${detail}`;
        ul.append(li);
    }
    $('skipped-details').hidden = p.skipped.length === 0;
    renderPlanGrid(p);
    log(t('log_preview', p.ops.length, p.skipped.length), 'ok');
}

/**
 * Apparence d'une nuit du plan : au bon prix (vert), à modifier (la couleur
 * du tarif qui va lui être appliqué, et choisissable), ou conservée telle
 * quelle (grise) ; réservée, bloquée et passée par-dessus.
 */
function planCell(date, cur, next, reason, { basePrice, level }) {
    const flags = [];
    if (cur?.reserved) {
        flags.push('reserved');
    }
    else if (cur?.available === false) {
        flags.push('blocked');
    }
    if (date < today()) {
        flags.push('past');
    }
    if (!cur || typeof cur.price !== 'number') {
        return { state: 'unknown', flags, title: `${describeDate(date)} · ${t('cell_unknown')}` };
    }
    const same = cur.price === next.price;
    const isCustom = typeof cur.custom === 'boolean' ? cur.custom : cur.price !== basePrice;
    const kept = reason === 'custom';
    const notes = [];
    if (!same) {
        notes.push(t(kept ? 'note_custom_kept'
            : flags.includes('reserved') ? 'note_reserved_kept'
                : flags.includes('past') ? 'note_past'
                    : isCustom ? 'note_custom_overwritten' : 'note_to_change'));
    }
    else if (flags.includes('reserved')) {
        notes.push(t('note_reserved'));
    }
    if (flags.includes('blocked')) {
        notes.push(t('note_blocked'));
    }
    const title = `${describeDate(date)} · ${cur.price} €${same ? '' : ` → ${next.price} €`}${notes.length ? ` · ${notes.join(', ')}` : ''}`;
    const applied = !same && !kept && !flags.includes('reserved') && !flags.includes('past');
    if (applied) {
        return { level, flags, selectable: true, title };
    }
    return { state: same ? 'ok' : 'custom', flags, title };
}

/**
 * Grille du plan : chaque nuit de l'année cible est au bon prix, à modifier
 * (dans la couleur du tarif à appliquer) ou conservée telle quelle ; réservée
 * ou passée s'ajoutent par-dessus. Sans plan (`null`), toutes les nuits sont
 * en attente de lecture. Les nuits à modifier se choisissent sur la grille ;
 * à l'application, elles passent au bon prix.
 */
function renderPlanGrid(p) {
    const cells = {};
    const basePrice = Number($('base-price').value);
    const proposed = state.proposed ?? {};
    const current = state.current ?? {};
    const skipped = new Map((p?.skipped ?? []).map((s) => [s.date, s.reason]));
    const scale = priceLevels(proposed);
    for (const [date, next] of Object.entries(proposed)) {
        cells[date] = p
            ? planCell(date, current[date], next, skipped.get(date), { basePrice, level: scale.levels[date] })
            : { state: 'pending', title: `${describeDate(date)} · ${t('cell_reading')}` };
    }
    const seen = new Set(Object.values(cells).flatMap((c) => [...(c.flags ?? []), c.state]));
    state.planGrid = renderYearGrid($('plan-grid'), state.targetYear, cells, {
        legend: [
            { scale: [scale.min, scale.max], label: t('legend_to_apply') },
            { state: 'ok', label: t('legend_ok') },
            ...(seen.has('custom') || !p ? [{ state: 'custom', label: t('legend_kept') }] : []),
            ...(seen.has('reserved') || !p ? [{ flags: ['reserved'], label: t('note_reserved') }] : []),
            ...(seen.has('blocked') ? [{ flags: ['blocked'], label: t('note_blocked') }] : []),
            ...(seen.has('past') ? [{ state: 'ok', flags: ['past'], label: t('note_past') }] : []),
        ],
        onSelect: p ? syncSelectionButton : null,
    });
    return state.planGrid;
}

/** Une nuit enregistrée au bon prix n'est plus à choisir. */
function markOp(op, stateName) {
    for (const date of eachDay(op.from, op.to)) {
        state.planGrid?.setState(date, stateName, { selectable: stateName !== 'ok' });
    }
}

/** Opérations du plan sur les nuits données, sans celles déjà enregistrées. */
function opsFor(dates) {
    return opsForDates(state.plan.ops, [...dates].filter((date) => !state.applied.has(date)), { weekdayPattern: site?.supportsWeekdayPattern === true });
}

function plannedDates() {
    return state.plan.ops.flatMap((op) => [...eachDay(op.from, op.to)]);
}

/*
 * Pause et arrêt de l'enregistrement. Une opération, une fois lancée dans la
 * page, va jusqu'au bout (sélection, saisie, enregistrement, vérification) :
 * la pause comme l'arrêt prennent effet entre deux opérations.
 */
const run = { paused: false, stopped: false, resume: null };
/* Le site a confirmé l'opération précédente avant qu'elle ne rende la main : un simple souffle entre deux. */
const BREATH_MS = 400;

function setRunning(running) {
    for (const id of ['apply', 'apply-selection']) {
        $(id).hidden = running;
    }
    for (const id of ['pause', 'stop']) {
        $(id).hidden = !running;
        $(id).disabled = false;
    }
    run.paused = false;
    run.stopped = false;
    run.resume = null;
    $('pause').textContent = t('btn_pause');
    $('pause').classList.remove('primary');
}

function setPaused(paused) {
    run.paused = paused;
    $('pause').textContent = t(paused ? 'btn_resume' : 'btn_pause');
    $('pause').classList.toggle('primary', paused);
    $('apply-hint').textContent = paused ? t('hint_pause_pending') : '';
    if (!paused) {
        run.resume?.();
    }
}

function requestStop() {
    run.stopped = true;
    $('stop').disabled = true;
    $('pause').disabled = true;
    $('apply-hint').textContent = run.resume ? '' : t('hint_stop_pending');
    log(t('log_stop_requested'));
    run.resume?.();
}

/** Attend la reprise si une pause est demandée ; vrai si l'arrêt a été demandé entre-temps. */
async function pauseGate(done, total) {
    if (run.paused && !run.stopped) {
        $('plan-summary').textContent = t('paused_after', done, total);
        $('apply-hint').textContent = '';
        await new Promise((resolve) => { run.resume = resolve; });
        run.resume = null;
    }
    return run.stopped;
}

async function applyOps(ops) {
    if (!ops.length) {
        return;
    }
    setApply(false, '');
    $('plan').disabled = true;
    applying = true;
    setRunning(true);
    const totalNights = ops.reduce((sum, op) => sum + op.nights, 0);
    let done = 0;
    let doneNights = 0;
    let failed = false;
    let stopped = false;
    setProgress(0, totalNights);
    try {
        for (const op of ops) {
            if (await pauseGate(done, ops.length)) {
                stopped = true;
                break;
            }
            $('plan-summary').textContent = t('applying_op', describeOp(op), op.from, op.to);
            markOp(op, 'busy');
            try {
                await callAdapter('applyPrice', op);
                markOp(op, 'ok');
                for (const date of eachDay(op.from, op.to)) {
                    state.applied.add(date);
                }
                done += 1;
                doneNights += op.nights;
                setProgress(doneNights, totalNights);
            }
            catch (e) {
                markOp(op, 'error');
                failed = true;
                setProgress(doneNights, totalNights, { failed: true });
                log(t('log_stop_error', e.message), 'error');
                break;
            }
            await new Promise((r) => setTimeout(r, BREATH_MS));
        }
    }
    finally {
        applying = false;
        setRunning(false);
    }
    const complete = done === ops.length && !failed;
    $('plan-summary').textContent = complete
        ? t('done_complete', done, doneNights)
        : t(stopped ? 'done_stopped' : 'done_interrupted', done, ops.length);
    log(t('log_applied', done, ops.length), complete || stopped ? 'ok' : 'error');
    $('plan').disabled = false;
    const outcome = t(complete ? 'outcome_saved' : stopped ? 'outcome_stopped' : 'outcome_interrupted');
    const remaining = opsFor(plannedDates()).reduce((sum, op) => sum + op.nights, 0);
    if (remaining) {
        setApply(true);
        $('apply-hint').textContent = t('hint_remaining', outcome, remaining);
    }
    else {
        setApply(false, t('hint_done_verify', outcome));
    }
}

/* ---------- Câblage ---------- */

$('year').addEventListener('change', () => { $('target-year').value = Number($('year').value) + 1; syncMode(); });
$('base-price').addEventListener('change', persist);
$('read').addEventListener('click', readCalendar);
$('export').addEventListener('click', exportJson);
$('import').addEventListener('change', (e) => e.target.files[0] && importJson(e.target.files[0]));
$('mode').addEventListener('change', syncMode);
for (const id of ['factor', 'rounding', 'special-days']) {
    $(id).addEventListener('change', saveSettings);
}
await restoreSettings();
$('show-log').addEventListener('change', () => { syncLogVisibility(); saveSettings(); });
$('language').addEventListener('change', async () => { await applyLanguage(); saveSettings(); });
document.addEventListener('click', (e) => {
    for (const settings of document.querySelectorAll('details.settings')) {
        if (settings.open && !settings.contains(e.target)) {
            settings.open = false;
        }
    }
});
$('plan').addEventListener('click', simulate);
$('apply').addEventListener('click', () => applyOps(opsFor(plannedDates())));
$('apply-selection').addEventListener('click', () => applyOps(opsFor(state.planGrid.selected())));
$('pause').addEventListener('click', () => setPaused(!run.paused));
$('stop').addEventListener('click', requestStop);

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
