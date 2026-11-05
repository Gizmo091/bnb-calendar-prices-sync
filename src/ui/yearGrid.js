/**
 * Grille de l'année : douze lignes de trente et un jours, une case par nuit.
 * C'est le seul endroit du panneau qui porte de la couleur : le niveau de
 * prix (teinte de l'accent) ou l'état d'une nuit dans le plan.
 *
 * `cells` associe une date ISO à `{ level?, state?, flags?, title? }` :
 * - `level` entre 0 et 1, quantifié en cinq paliers de l'accent ;
 * - `state` parmi ok, diff, custom, pending, next, busy, error, unknown : la couleur de fond ;
 * - `flags` parmi reserved, blocked, past : des marques qui se superposent
 *   à la couleur (hachures, atténuation) sans la remplacer ;
 * - `title` est l'infobulle de la case.
 */
import { eachDay, yearBounds, weekday } from '../core/index.js';

const FLAGS = ['reserved', 'blocked', 'past'];

function applySpec(cell, spec) {
    if (typeof spec.level === 'number') {
        cell.dataset.level = String(Math.min(LEVELS, 1 + Math.round(spec.level * (LEVELS - 1))));
    }
    if (spec.state) {
        cell.dataset.state = spec.state;
    }
    for (const flag of spec.flags ?? []) {
        if (FLAGS.includes(flag)) {
            cell.dataset[flag] = '';
        }
    }
    if (spec.title) {
        cell.title = spec.title;
    }
}
const MONTHS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc'];
const LEVELS = 5;

/**
 * `legend` liste des entrées `{ label, state?, level?, flags? }` rendues comme
 * une case, ou `{ scale: [min, max] }` : une réglette des cinq paliers de prix.
 */
export function renderYearGrid(el, year, cells, { legend = [] } = {}) {
    el.innerHTML = '';
    el.hidden = false;
    const { from, to } = yearBounds(year);
    const index = new Map();
    let month = -1;
    for (const date of eachDay(from, to)) {
        const m = Number(date.slice(5, 7)) - 1;
        if (m !== month) {
            month = m;
            const label = document.createElement('span');
            label.className = 'month';
            label.textContent = MONTHS[m];
            label.style.gridColumn = '1';
            label.style.gridRow = String(m + 1);
            el.append(label);
        }
        const cell = document.createElement('i');
        cell.className = 'cell';
        cell.style.gridColumn = String(Number(date.slice(8, 10)) + 1);
        cell.style.gridRow = String(m + 1);
        if (weekday(date) === 6) {
            cell.classList.add('sat');
        }
        const c = cells[date];
        if (c) {
            applySpec(cell, c);
        }
        else {
            cell.dataset.state = 'unknown';
        }
        el.append(cell);
        index.set(date, cell);
    }
    if (legend.length) {
        const ul = document.createElement('ul');
        ul.className = 'legend';
        for (const item of legend) {
            const li = document.createElement('li');
            if (item.scale) {
                // Échelle de prix : les cinq paliers de l'accent, du plus bas au plus haut.
                const [min, max] = item.scale;
                const strip = document.createElement('span');
                strip.className = 'scale';
                for (let level = 1; level <= LEVELS; level++) {
                    const step = document.createElement('i');
                    step.className = 'cell';
                    step.dataset.level = String(level);
                    strip.append(step);
                }
                li.className = 'range';
                li.title = `Prix des nuits, du plus bas (${min} €) au plus haut (${max} €)`;
                li.append(document.createTextNode(`${min} €`), strip, document.createTextNode(`${max} €`));
                ul.append(li);
                continue;
            }
            const swatch = document.createElement('i');
            swatch.className = 'cell';
            if (item.level !== undefined) {
                swatch.dataset.level = String(item.level);
            }
            applySpec(swatch, { ...item, level: undefined });
            li.append(swatch, document.createTextNode(item.label));
            ul.append(li);
        }
        el.append(ul);
    }
    return {
        setState(date, state) {
            const cell = index.get(date);
            if (cell) {
                cell.dataset.state = state;
            }
        },
        /**
         * Remplace entièrement l'apparence d'une case (couleur, marques,
         * infobulle). Avec `delay`, la case garde son air d'attente puis se
         * révèle d'un petit mouvement à l'instant dit, ce qui permet de
         * dévoiler les nuits une à une.
         */
        update(date, spec, { delay = null } = {}) {
            const cell = index.get(date);
            if (!cell) {
                return;
            }
            for (const key of ['level', 'state', ...FLAGS]) {
                delete cell.dataset[key];
            }
            cell.removeAttribute('title');
            cell.classList.remove('reveal');
            applySpec(cell, spec);
            if (delay !== null) {
                void cell.offsetWidth;
                cell.style.animationDelay = `${Math.max(0, Math.round(delay))}ms`;
                cell.classList.add('reveal');
                cell.addEventListener('animationend', () => {
                    cell.classList.remove('reveal');
                    cell.style.animationDelay = '';
                }, { once: true });
            }
        },
    };
}

/**
 * Niveau de prix relatif par rang : le prix le plus bas vaut 0, le plus haut 1,
 * ce qui garde des paliers lisibles même quand une saison écrase les autres.
 * @param {Object<string,{price:number}>} days
 */
export function priceLevels(days) {
    const prices = [...new Set(Object.values(days).map((d) => d.price).filter((p) => typeof p === 'number'))].sort((a, b) => a - b);
    const levels = {};
    for (const [date, day] of Object.entries(days)) {
        if (typeof day.price === 'number') {
            levels[date] = prices.length > 1 ? prices.indexOf(day.price) / (prices.length - 1) : 0;
        }
    }
    return { levels, min: prices[0], max: prices[prices.length - 1] };
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function describeDate(date) {
    return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}
