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
 *   La lecture rejoue cette requête (URL retrouvée dans les entrées de
 *   performance de la page, clé d'API dans son HTML) sur une année entière,
 *   et ne se replie sur le défilement du calendrier qu'en cas d'échec.
 */
import { parsePrice, priceInText, sleep, waitFor, setInputValue } from './common.js';
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
        throw new Error('Calendrier introuvable : ouvrez la page « Calendrier » de l\'annonce.');
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
                    throw new Error(`La date ${date} n'est pas atteignable dans le calendrier.`);
                }
            }
            list.scrollTop = Math.max(0, list.scrollTop - SCROLL_STEP);
        }
        else {
            list.scrollTop += SCROLL_STEP;
        }
        await sleep(SCROLL_WAIT);
    }
    throw new Error(`La date ${date} n'a pas été trouvée dans le calendrier.`);
}

const API_OPERATION = 'getDLSHostCalendar';

/** URL complète de la dernière requête calendrier émise par la page. */
function calendarQueryUrl() {
    const entries = performance.getEntriesByType('resource').map((e) => e.name);
    return entries.reverse().find((u) => u.includes(`/api/v3/${API_OPERATION}/`)) ?? null;
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
        throw new Error(`API calendrier : HTTP ${response.status}`);
    }
    const json = await response.json();
    const days = json?.data?.presentation?.hostCalendar?.sections?.calendarGridViewSection?.days;
    if (!Array.isArray(days)) {
        throw new Error(json?.errors?.[0]?.message ?? 'API calendrier : réponse inattendue');
    }
    return days;
}

/** Lecture par l'API interne, une requête par année civile couverte. */
async function readCalendarFromApi(from, to) {
    const baseUrl = calendarQueryUrl();
    const key = apiKey();
    if (!baseUrl || !key) {
        throw new Error('requête calendrier introuvable dans la page');
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
            days[d.day] = { price, available: d.available === true, reserved: Boolean(d.reservationData) };
        }
    }
    return days;
}

function sidebarButton(predicate) {
    const side = document.querySelector(SEL.sidebar);
    return side ? [...side.querySelectorAll('button')].find(predicate) ?? null : null;
}

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
        await sleep(500);
    }
    if (selectedDates().length) {
        throw new Error('Impossible de désélectionner les nuits en cours.');
    }
}

export default {
    id: SITE,
    label: 'Airbnb',

    matches(hostname) {
        return /(^|\.)airbnb\.(fr|com)$/.test(hostname);
    },

    async info() {
        const listingId = location.pathname.match(/\/multicalendar\/(\d+)/)?.[1] ?? null;
        return { site: SITE, listingId, url: location.href, calibrated: CALIBRATED };
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
            throw new Error(`Sélection inattendue pour ${from} → ${to} : ${selected.length} nuit(s) sélectionnée(s) au lieu de ${expected.length}.`);
        }

        const card = sidebarButton((b) => /Prix par nuit/.test(b.innerText));
        if (!card) {
            await closeSidebar();
            throw new Error('Carte « Prix par nuit » introuvable dans la barre latérale.');
        }
        card.click();
        await sleep(800);
        let input = document.querySelector(SEL.priceInput);
        if (!input) {
            const rangeButton = sidebarButton((b) => PRICE_RANGE_RE.test(b.innerText));
            rangeButton?.click();
            input = await waitFor(SEL.priceInput, { timeout: 5000 }).catch(() => null);
        }
        if (!input) {
            await closeSidebar();
            throw new Error('Champ de prix introuvable.');
        }
        setInputValue(input, price);
        await sleep(500);
        const submit = document.querySelector(SEL.submit);
        if (!submit || submit.disabled) {
            await closeSidebar();
            throw new Error(submit ? 'Le bouton Enregistrer reste désactivé (prix identique ?).' : 'Bouton Enregistrer introuvable.');
        }
        submit.click();
        for (let i = 0; i < 40 && document.querySelector(SEL.priceInput); i++) {
            await sleep(250);
        }
        if (document.querySelector(SEL.priceInput)) {
            await closeSidebar();
            throw new Error('Le formulaire de prix ne s\'est pas fermé après Enregistrer.');
        }
        await sleep(600);
        const check = parseDayButton(document.querySelector(SEL.dayAt(from)) ?? (await scrollToDate(from)));
        await closeSidebar();
        if (check && check.price !== price) {
            throw new Error(`Le calendrier affiche ${check.price} € pour ${from} au lieu de ${price} €.`);
        }
        return { from, to, price };
    },
};
