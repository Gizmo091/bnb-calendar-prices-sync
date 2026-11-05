/**
 * Adaptateur Airbnb : calendrier hôte (https://www.airbnb.fr/multicalendar/<listingId>).
 *
 * Calibré le 2026-11-04 sur l'interface réelle :
 * - chaque jour est un `button[data-date="YYYY-MM-DD"]` dans une liste
 *   virtualisée (`[data-testid="virtuoso-scroller"]`) : seuls quelques mois
 *   sont dans le DOM, il faut faire défiler pour lire ou atteindre une date ;
 * - le texte du bouton contient « Prix par nuit | 118 € », « Non disponible »
 *   quand la nuit est bloquée, et rien du tout pour une nuit réservée ou passée ;
 * - un clic sélectionne un jour, un maj+clic étend la sélection jusqu'à ce jour ;
 * - la barre latérale (section aria-label « Barre latérale de modification des
 *   jours sélectionnés ») contient une carte « Prix par nuit » qui ouvre le
 *   formulaire : champ `#PriceInput-nightlyPrice` (précédé d'un bouton
 *   « 90 € – 160 € » à cliquer quand les prix de la sélection diffèrent) et
 *   bouton `[data-testid="nightlyPriceForm-submit"]` ;
 * - le prix de base est lisible dans le panneau de droite (« Tarification »)
 *   quand aucune nuit n'est sélectionnée ;
 * - la page charge ses données par une requête GraphQL persistée
 *   (`getDLSHostCalendar`) dont la réponse donne `priceData.price` pour chaque
 *   nuit, y compris les nuits passées et réservées que l'interface masque.
 *   Ce prix est le prix nominal fixé par l'hôte : sur une nuit couverte par
 *   une promotion, le calendrier affiche le prix remisé, la requête donne le
 *   prix nominal et `promotionType` (vérifié : 398 € nominal, 318 € affiché
 *   avec 20 % de réduction).
 *   La lecture rejoue cette requête (URL retrouvée dans les entrées de
 *   performance de la page, clé d'API dans son HTML) sur une année entière,
 *   et ne se replie sur le défilement du calendrier qu'en cas d'échec.
 */
import { parsePrice, priceInText, sleep, waitFor, setInputValue } from './common.js';
import { t } from '../core/i18n.js';
import { eachDay, yearOf, yearBounds } from '../core/dates.js';

const SITE = 'airbnb';
const CALIBRATED = true;

const SEL = {
    scroller: '[data-testid="virtuoso-scroller"]',
    day: 'button[data-date]',
    dayAt: (d) => `button[data-date="${d}"]`,
    selectedDays: '[role="gridcell"][aria-selected="true"] button[data-date]',
    sidebar: 'section[aria-label="Barre latérale de modification des jours sélectionnés"]',
    priceInput: '#PriceInput-nightlyPrice',
    submit: '[data-testid="nightlyPriceForm-submit"]',
};

const PRICE_RANGE_RE = /^\s*[\d\s ]+€(\s*–\s*[\d\s ]+€)?\s*$/;
const SCROLL_STEP = 700;
const SCROLL_WAIT = 250;

function scroller() {
    const el = document.querySelector(SEL.scroller);
    if (!el) {
        throw new Error(t('err_calendar_missing'));
    }
    return el;
}

function visibleDates() {
    return [...document.querySelectorAll(SEL.day)].map((b) => b.dataset.date).sort();
}

function selectedDates() {
    return [...document.querySelectorAll(SEL.selectedDays)].map((b) => b.dataset.date).sort();
}

function parseDayButton(button) {
    const text = button.innerText;
    const price = priceInText(text);
    if (price === null) {
        return null;
    }
    return {
        price,
        available: !/Non disponible/.test(text),
    };
}

/** Fait défiler la liste virtualisée jusqu'à ce que la date soit dans le DOM. */
async function scrollToDate(date) {
    const list = scroller();
    for (let i = 0; i < 120; i++) {
        const btn = document.querySelector(SEL.dayAt(date));
        if (btn) {
            btn.scrollIntoView({ block: 'center' });
            await sleep(SCROLL_WAIT);
            return btn;
        }
        const dates = visibleDates();
        if (!dates.length || date < dates[0]) {
            if (list.scrollTop === 0) {
                await sleep(600);
                if (!document.querySelector(SEL.dayAt(date)) && visibleDates()[0] === dates[0]) {
                    throw new Error(t('err_date_unreachable', date));
                }
            }
            list.scrollTop = Math.max(0, list.scrollTop - SCROLL_STEP);
        }
        else {
            list.scrollTop += SCROLL_STEP;
        }
        await sleep(SCROLL_WAIT);
    }
    throw new Error(t('err_date_not_found', date));
}

const API_OPERATION = 'getDLSHostCalendar';

/** URL complète de la dernière requête calendrier émise par la page. */
function calendarQueryUrl() {
    const entries = performance.getEntriesByType('resource').map((e) => e.name);
    return entries.reverse().find((u) => u.includes(`/api/v3/${API_OPERATION}/`)) ?? null;
}

/**
 * La balise <title> du HTML servi porte le nom de l'annonce :
 * « Modifier le calendrier pour <nom> - Airbnb » (ou l'équivalent anglais).
 * Le script de la page réécrit ensuite le titre, donc on relit le HTML
 * d'origine, une fois par page, et le titre courant ne sert qu'en secours.
 */
const nameCache = new Map();

function nameFromTitle(title) {
    const clean = (title ?? '').replace(/\s+/g, ' ').trim();
    const known = clean.match(/(?:Modifier le calendrier pour|Edit calendar for)\s+(.+?)\s*-\s*Airbnb$/i);
    if (known) {
        return known[1].trim();
    }
    const bare = clean.replace(/\s*-\s*Airbnb$/i, '').trim();
    return bare && bare !== clean ? bare : null;
}

async function servedTitle(url) {
    const response = await fetch(url, { credentials: 'include', headers: { accept: 'text/html' } });
    if (!response.ok) {
        return null;
    }
    const html = await response.text();
    return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"') ?? null;
}

async function listingName() {
    const url = location.origin + location.pathname;
    if (!nameCache.has(url)) {
        nameCache.set(url, servedTitle(url).then(nameFromTitle).catch(() => null));
    }
    const served = await nameCache.get(url);
    if (!served) {
        nameCache.delete(url);
    }
    return served ?? nameFromTitle(document.querySelector('title')?.textContent);
}

function apiKey() {
    return document.documentElement.innerHTML.match(/"api_config":\{"key":"([^"]+)"/)?.[1] ?? null;
}

async function fetchCalendarDays(baseUrl, key, startDate, endDate) {
    const url = new URL(baseUrl);
    const variables = JSON.parse(url.searchParams.get('variables'));
    url.searchParams.set('variables', JSON.stringify({ ...variables, startDate, endDate }));
    const response = await fetch(url, {
        headers: { 'x-airbnb-api-key': key, 'x-airbnb-graphql-platform': 'web' },
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(t('err_api_http', response.status));
    }
    const json = await response.json();
    const days = json?.data?.presentation?.hostCalendar?.sections?.calendarGridViewSection?.days;
    if (!Array.isArray(days)) {
        throw new Error(json?.errors?.[0]?.message ?? t('err_api_unexpected'));
    }
    return days;
}

/** Lecture par l'API interne, une requête par année civile couverte. */
async function readCalendarFromApi(from, to) {
    const baseUrl = calendarQueryUrl();
    const key = apiKey();
    if (!baseUrl || !key) {
        throw new Error(t('err_api_request_missing'));
    }
    const days = {};
    for (let year = yearOf(from); year <= yearOf(to); year++) {
        const bounds = yearBounds(year);
        const start = from > bounds.from ? from : bounds.from;
        const end = to < bounds.to ? to : bounds.to;
        for (const d of await fetchCalendarDays(baseUrl, key, start, end)) {
            const price = d?.priceData?.price;
            if (typeof price !== 'number' || d.day < from || d.day > to) {
                continue;
            }
            days[d.day] = {
                price,
                available: d.available === true,
                reserved: Boolean(d.reservationData),
                // Prix nominal : une promotion éventuelle (ex. « 20 % de réduction »)
                // est signalée à part, le calendrier affiché montrant lui le prix remisé.
                promotion: d.priceData.promotionType ?? null,
            };
        }
    }
    return days;
}

function sidebarButton(predicate) {
    const side = document.querySelector(SEL.sidebar);
    return side ? [...side.querySelectorAll('button')].find(predicate) ?? null : null;
}

/** Attend qu'un bouton de la barre latérale satisfasse le prédicat. */
async function waitForSidebarButton(predicate, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const button = sidebarButton(predicate);
        if (button) {
            return button;
        }
        await sleep(150);
    }
    return null;
}

async function waitUntilDeselected(timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!selectedDates().length) {
            return true;
        }
        await sleep(200);
    }
    return false;
}

/**
 * Referme la barre latérale et désélectionne toutes les nuits : bouton
 * Fermer, puis touche Échap, puis clic sur chaque nuit encore sélectionnée
 * (un clic sur une nuit sélectionnée la désélectionne).
 */
async function closeSidebar() {
    for (let i = 0; i < 3 && document.querySelector(SEL.sidebar); i++) {
        const cancel = sidebarButton((b) => b.innerText.trim() === 'Annuler');
        if (cancel) {
            cancel.click();
            await sleep(400);
        }
        const close = sidebarButton((b) => b.getAttribute('aria-label') === 'Fermer');
        if (!close) {
            break;
        }
        close.click();
        if (await waitUntilDeselected(1500)) {
            return;
        }
    }
    if (await waitUntilDeselected(1500)) {
        return;
    }
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (await waitUntilDeselected(1000)) {
        return;
    }
    for (const date of selectedDates()) {
        const btn = await scrollToDate(date).catch(() => null);
        if (btn) {
            btn.click();
            await sleep(300);
        }
    }
    if (!(await waitUntilDeselected(2000))) {
        throw new Error(t('err_deselect', selectedDates().join(', ')));
    }
}

export default {
    id: SITE,
    label: 'Airbnb',

    calendarUrl: 'https://www.airbnb.fr/multicalendar/<id>',
    matches(hostname) {
        return /(^|\.)airbnb\.(fr|com)$/.test(hostname);
    },

    async info() {
        const listingId = location.pathname.match(/\/multicalendar\/(\d+)/)?.[1] ?? null;
        const name = listingId ? await listingName() : null;
        return { site: SITE, listingId, name, url: location.href, calibrated: CALIBRATED };
    },

    /** Prix de base affiché dans le panneau « Tarification » (hors sélection). */
    async basePrice() {
        const match = document.body.innerText.match(/Tarification\s*\n\s*([\d\s ]+)\s*€ par nuit/);
        return match ? parsePrice(match[1]) : null;
    },

    /**
     * Lit les nuits de `from` à `to` : par l'API interne (toutes les nuits,
     * y compris passées et réservées), sinon par le calendrier affiché, où
     * les nuits passées et réservées n'ont pas de prix.
     */
    async readCalendar({ from, to }) {
        try {
            return await readCalendarFromApi(from, to);
        }
        catch (e) {
            console.warn(`[bnb-calendar-prices-sync] lecture par l'API impossible (${e.message}), repli sur le calendrier affiché`);
            return this.readCalendarFromDom({ from, to });
        }
    },

    async readCalendarFromDom({ from, to }) {
        const list = scroller();
        const days = {};
        const collect = () => {
            for (const btn of document.querySelectorAll(SEL.day)) {
                const date = btn.dataset.date;
                if (date < from || date > to) {
                    continue;
                }
                const parsed = parseDayButton(btn);
                if (parsed) {
                    days[date] = parsed;
                }
            }
        };
        await scrollToDate(from).catch(() => null);
        collect();
        for (let i = 0; i < 120; i++) {
            const dates = visibleDates();
            if (dates.length && dates.at(-1) >= to) {
                break;
            }
            const before = list.scrollTop;
            list.scrollTop += SCROLL_STEP;
            await sleep(SCROLL_WAIT);
            collect();
            if (list.scrollTop === before) {
                break;
            }
        }
        return days;
    },

    /**
     * Applique un prix sur une plage contiguë : sélection du premier jour,
     * maj+clic sur le dernier, saisie dans le formulaire, enregistrement.
     * Vérifie à chaque étape que la page est dans l'état attendu, et
     * s'interrompt sinon sans enregistrer.
     */
    async applyPrice({ from, to, price }) {
        await closeSidebar();
        const expected = [...eachDay(from, to)];

        const first = await scrollToDate(from);
        first.click();
        await sleep(400);
        if (to !== from) {
            const last = await scrollToDate(to);
            last.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
            await sleep(700);
        }
        const selected = selectedDates();
        if (selected.join() !== expected.join()) {
            await closeSidebar();
            throw new Error(t('err_selection_airbnb', from, to, selected.length, expected.length));
        }

        const card = await waitForSidebarButton((b) => /Prix par nuit/.test(b.innerText), 8000);
        if (!card) {
            const shown = document.querySelector(SEL.sidebar)?.innerText.replace(/\s+/g, ' ').slice(0, 160) ?? t('sidebar_missing');
            await closeSidebar();
            throw new Error(t('err_price_card', shown));
        }
        card.click();
        let input = await waitFor(SEL.priceInput, { timeout: 3000 }).catch(() => null);
        if (!input) {
            const rangeButton = await waitForSidebarButton((b) => PRICE_RANGE_RE.test(b.innerText), 3000);
            rangeButton?.click();
            input = await waitFor(SEL.priceInput, { timeout: 5000 }).catch(() => null);
        }
        if (!input) {
            await closeSidebar();
            throw new Error(t('err_price_field'));
        }
        setInputValue(input, price);
        await sleep(500);
        const submit = document.querySelector(SEL.submit);
        if (!submit || submit.disabled) {
            await closeSidebar();
            throw new Error(t(submit ? 'err_submit_disabled' : 'err_submit_missing'));
        }
        submit.click();
        for (let i = 0; i < 40 && document.querySelector(SEL.priceInput); i++) {
            await sleep(250);
        }
        if (document.querySelector(SEL.priceInput)) {
            await closeSidebar();
            throw new Error(t('err_form_not_closed'));
        }
        await sleep(600);
        const check = parseDayButton(document.querySelector(SEL.dayAt(from)) ?? (await scrollToDate(from)));
        await closeSidebar();
        if (check && check.price !== price) {
            throw new Error(t('err_price_mismatch', check.price, from, price));
        }
        return { from, to, price };
    },
};
