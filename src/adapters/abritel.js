/**
 * Adaptateur Abritel / Vrbo : calendrier propriétaire
 * (https://www.abritel.fr/p/calendar/<listingId>).
 *
 * Calibré le 2026-11-04 sur l'interface réelle :
 * - la vue « Année » affiche douze tableaux `table[aria-label="mai 2027"]`,
 *   une cellule `td[aria-label="10 mai 2027"]` par jour, le prix dans
 *   `.DayDate__rate` (repli : la ligne du texte qui porte le symbole €).
 *   Le libellé prend un suffixe (« is unavailable. », « is selected as your
 *   check-in date. ») selon l'état, d'où une comparaison par préfixe ;
 * - les nuits réservées ou bloquées portent une barre `.DayDate__event`
 *   (« Importé », « Réservé », « Bloqué »…) et gardent leur prix affiché ;
 * - l'année s'ouvre par le bouton `#year-selector` puis
 *   `li[data-automation-id="year-2027"]` ;
 * - la sélection d'une plage se fait par deux clics réels (événements pointer
 *   et souris : un simple `.click()` est ignoré) sur la cellule de début puis
 *   de fin. Le rail de droite affiche alors « Tarifs et réductions », qui
 *   ouvre un formulaire avec `#ratePerNight` et un bouton Enregistrer. Si la
 *   sélection mélange plusieurs prix, le formulaire s'ouvre en mode « par nuit
 *   de la semaine » (`#isCustomizeModeActive` coché) : on le décoche. Après
 *   Enregistrer, le formulaire reste ouvert mais le calendrier est mis à jour
 *   presque immédiatement ; la dernière nuit sélectionnée est incluse ;
 * - le prix de base est lisible dans le rail « Paramètres » quand rien n'est
 *   sélectionné.
 */
import { parsePrice, priceInText, sleep, waitFor } from './common.js';
import { yearOf } from '../core/dates.js';
import { priceForDate } from '../core/ranges.js';

const SITE = 'abritel';
const CALIBRATED = true;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const LABEL_RE = /^(\d{1,2}) (\S+) (\d{4})/;

const SEL = {
    tables: 'table[aria-label]',
    cells: 'table[aria-label] td[aria-label]',
    rate: '.DayDate__rate',
    event: '.DayDate__event',
    yearSelector: '#year-selector',
    yearItem: (y) => `li[data-automation-id="year-${y}"]`,
    rateInput: '#ratePerNight',
    customizeMode: '#isCustomizeModeActive',
    weekdayInput: (day) => `input[name="dayOfWeekValues.${day}"]`,
    startInput: '#input1-rail-datepicker',
    endInput: '#input2-rail-datepicker',
};

function realClick(el) {
    const r = el.getBoundingClientRect();
    const init = {
        bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
    }
}

function dateOfLabel(label) {
    const m = LABEL_RE.exec(label ?? '');
    if (!m) {
        return null;
    }
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month < 0) {
        return null;
    }
    return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function cellFor(date) {
    for (const td of document.querySelectorAll(SEL.cells)) {
        if (dateOfLabel(td.getAttribute('aria-label')) === date) {
            return td;
        }
    }
    return null;
}

function parseCell(td) {
    const label = td.getAttribute('aria-label') ?? '';
    const rateEl = td.querySelector(SEL.rate);
    const price = rateEl ? parsePrice(rateEl.textContent) : priceInText(td.innerText);
    if (price === null) {
        return null;
    }
    // Un événement dans la case est une réservation, directe ou importée
    // d'un autre site par iCal ; la nuit n'est plus à tarifer.
    const reserved = td.querySelector(SEL.event) !== null || td.querySelector('[aria-label]') !== null;
    return {
        price,
        available: !reserved && !/unavailable/.test(label),
        reserved,
    };
}

function findByText(selector, re) {
    return [...document.querySelectorAll(selector)].find((el) => re.test(el.innerText ?? '')) ?? null;
}

function selectedLabels() {
    return [...document.querySelectorAll(SEL.cells)]
        .map((td) => td.getAttribute('aria-label'))
        .filter((l) => /selected/.test(l));
}

async function closeRail() {
    for (let i = 0; i < 3; i++) {
        const cancel = findByText('button', /^Annuler$/);
        if (cancel) {
            cancel.click();
            await sleep(400);
        }
        const close = [...document.querySelectorAll('button[aria-label]')].find((b) => /^Fermer/.test(b.getAttribute('aria-label')));
        if (!close) {
            break;
        }
        close.click();
        await sleep(600);
    }
    if (selectedLabels().length || document.querySelector(SEL.rateInput)) {
        throw new Error('Impossible de fermer le panneau de droite.');
    }
}

/** Affiche la vue « Année » de l'année demandée. */
async function ensureYearView(year) {
    const yearShown = () => {
        const tables = document.querySelectorAll(SEL.tables);
        return tables.length >= 12 && [...tables].every((t) => t.getAttribute('aria-label').endsWith(String(year)));
    };
    if (yearShown()) {
        return;
    }
    if (document.querySelectorAll(SEL.tables).length < 12) {
        const tab = findByText('a, button', /^Année$/);
        if (!tab) {
            throw new Error('Onglet « Année » introuvable.');
        }
        tab.click();
        await sleep(1200);
    }
    if (!yearShown()) {
        const selector = document.querySelector(SEL.yearSelector);
        if (!selector) {
            throw new Error('Sélecteur d\'année introuvable.');
        }
        realClick(selector);
        const item = await waitFor(SEL.yearItem(year), { timeout: 3000 }).catch(() => null);
        if (!item) {
            document.body.click();
            throw new Error(`L'année ${year} n'est pas proposée par le calendrier Abritel.`);
        }
        realClick(item);
        for (let i = 0; i < 30 && !yearShown(); i++) {
            await sleep(300);
        }
    }
    if (!yearShown()) {
        throw new Error(`La vue Année ${year} ne s'est pas affichée.`);
    }
}

const SAVE_ATTEMPTS = 3;
const SAVE_RETRY_DELAY_MS = 3000;

/** Modale d'erreur d'Abritel après un enregistrement refusé. */
function errorModal() {
    for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
        const text = el.innerText ?? '';
        if (/erreur est survenue|essayez .* à nouveau/i.test(text) && !el.querySelector(SEL.rateInput)) {
            return { element: el, text: text.replace(/\s+/g, ' ').trim().slice(0, 200) };
        }
    }
    return null;
}

async function dismissModal(element) {
    const button = [...element.querySelectorAll('button')].find((b) => /fermer|ok|réessayer|compris/i.test((b.getAttribute('aria-label') ?? '') + b.innerText))
        ?? element.querySelector('button');
    if (button) {
        button.click();
    }
    else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    for (let i = 0; i < 20 && document.body.contains(element); i++) {
        await sleep(200);
    }
}

function setRateValue(input, price) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, String(price).replace('.', ','));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    input.dispatchEvent(new Event('blur', { bubbles: true }));
}

export default {
    id: SITE,
    label: 'Abritel / Vrbo',
    /** Le formulaire sait enregistrer un tarif par nuit de la semaine sur toute une période. */
    supportsWeekdayPattern: true,

    calendarUrl: 'https://www.abritel.fr/p/calendar/<id>',
    matches(hostname) {
        return /(^|\.)(abritel\.fr|vrbo\.com)$/.test(hostname);
    },

    async info() {
        const listingId = location.pathname.match(/\/p\/calendar\/([\d.]+)/)?.[1] ?? null;
        // Le bouton de choix d'hébergement, en tête de page, affiche le nom puis la référence et l'adresse.
        const picker = document.querySelector('button[aria-label="Sélectionner un hébergement"]');
        const name = picker ? [...picker.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim())?.textContent.trim() ?? null : null;
        return { site: SITE, listingId, name, url: location.href, calibrated: CALIBRATED };
    },

    async basePrice() {
        const match = document.body.innerText.match(/Tarif de base\s*\n\s*([\d\s ]+(?:[.,]\d+)?)\s*€/);
        return match ? parsePrice(match[1]) : null;
    },

    /** Lit les nuits de `from` à `to` depuis la vue Année (toutes les nuits ont un prix, même passées). */
    async readCalendar({ from, to }) {
        await closeRail();
        const days = {};
        for (let year = yearOf(from); year <= yearOf(to); year++) {
            await ensureYearView(year);
            for (const td of document.querySelectorAll(SEL.cells)) {
                const date = dateOfLabel(td.getAttribute('aria-label'));
                if (!date || date < from || date > to) {
                    continue;
                }
                const parsed = parseCell(td);
                if (parsed) {
                    days[date] = parsed;
                }
            }
        }
        return days;
    },

    /**
     * Applique une opération sur une plage contiguë d'une même année :
     * sélection de la première et de la dernière nuit, formulaire « Tarifs et
     * réductions » (prix unique, ou un prix par nuit de la semaine quand
     * l'opération porte `byWeekday`), enregistrement, puis relecture de la
     * première nuit pour vérifier.
     */
    async applyPrice(op) {
        const { from, to, byWeekday } = op;
        const price = priceForDate(op, from);
        if (yearOf(from) !== yearOf(to)) {
            throw new Error(`La plage ${from} → ${to} chevauche deux années : à découper.`);
        }
        await closeRail();
        await ensureYearView(yearOf(from));

        const first = cellFor(from);
        if (!first) {
            throw new Error(`Nuit ${from} introuvable dans le calendrier.`);
        }
        realClick(first.querySelector('[data-automation-id]') ?? first);
        await sleep(700);
        if (to !== from) {
            const last = cellFor(to);
            if (!last) {
                await closeRail();
                throw new Error(`Nuit ${to} introuvable dans le calendrier.`);
            }
            realClick(last.querySelector('[data-automation-id]') ?? last);
            await sleep(900);
        }
        const selected = selectedLabels();
        const okStart = selected.some((l) => dateOfLabel(l) === from && /check-in/.test(l));
        const okEnd = to === from || selected.some((l) => dateOfLabel(l) === to && /checkout/.test(l));
        if (!okStart || !okEnd) {
            await closeRail();
            throw new Error(`Sélection inattendue pour ${from} → ${to} : ${selected.join(' / ') || 'rien'}.`);
        }

        const rates = findByText('a, button', /Tarifs et réductions/);
        if (!rates) {
            await closeRail();
            throw new Error('Entrée « Tarifs et réductions » introuvable dans le panneau.');
        }
        rates.click();
        const input = await waitFor(SEL.rateInput, { timeout: 6000 }).catch(() => null);
        if (!input) {
            await closeRail();
            throw new Error('Champ « Montant par nuit » introuvable.');
        }
        // Quand la sélection mélange plusieurs prix, le formulaire s'ouvre en
        // mode « par nuit de la semaine » et ignore le champ principal :
        // on repasse en tarif unique via la case à cocher du mode.
        // Une opération à motif hebdomadaire utilise ce mode ; une opération à
        // prix unique le désactive.
        const wantCustomize = Boolean(byWeekday);
        const modeSwitch = document.querySelector(SEL.customizeMode);
        if (modeSwitch && modeSwitch.checked !== wantCustomize) {
            modeSwitch.click();
            await sleep(500);
        }
        if (Boolean(document.querySelector(SEL.customizeMode)?.checked) !== wantCustomize) {
            await closeRail();
            throw new Error(`Impossible de ${wantCustomize ? 'activer' : 'désactiver'} le mode « tarifs par nuit de la semaine ».`);
        }
        if (byWeekday) {
            for (const [day, dayPrice] of Object.entries(byWeekday)) {
                const field = document.querySelector(SEL.weekdayInput(day));
                if (!field) {
                    await closeRail();
                    throw new Error(`Champ du tarif « ${day} » introuvable.`);
                }
                setRateValue(field, dayPrice);
            }
        }
        else {
            setRateValue(input, price);
        }
        await sleep(500);
        const submit = input.closest('form')?.querySelector('button[type="submit"]') ?? findByText('button', /^Enregistrer$/);
        if (!submit || submit.disabled) {
            await closeRail();
            throw new Error(submit ? 'Le bouton Enregistrer reste désactivé (prix identique ?).' : 'Bouton Enregistrer introuvable.');
        }
        // Après Enregistrer, Abritel garde le formulaire ouvert : c'est la
        // cellule du calendrier qui confirme la prise en compte (en général
        // sous la seconde). En cas d'erreur serveur, une modale « Une erreur
        // est survenue lors de la sauvegarde… » apparaît : on la ferme et on
        // réessaie avec une pause croissante.
        const reflected = () => {
            const td = cellFor(from);
            return td ? parseCell(td)?.price === price : false;
        };
        let lastError = null;
        for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                await sleep(SAVE_RETRY_DELAY_MS * attempt);
            }
            const button = input.closest('form')?.querySelector('button[type="submit"]') ?? findByText('button', /^Enregistrer$/);
            if (!button || button.disabled) {
                break;
            }
            button.click();
            lastError = null;
            for (let i = 0; i < 40 && !reflected(); i++) {
                await sleep(250);
                const modal = errorModal();
                if (modal) {
                    lastError = modal.text;
                    await dismissModal(modal.element);
                    break;
                }
            }
            if (reflected()) {
                break;
            }
        }
        const ok = reflected();
        await closeRail();
        if (!ok) {
            const shown = cellFor(from) ? parseCell(cellFor(from))?.price : null;
            throw new Error(lastError
                ? `Abritel a refusé l'enregistrement de ${from} → ${to} après ${SAVE_ATTEMPTS} essais : « ${lastError} »`
                : `Le calendrier affiche ${shown ?? '?'} € pour ${from} au lieu de ${price} € après Enregistrer.`);
        }
        return { from, to, price };
    },
};
