/**
 * Grille de l'année : douze lignes de trente et un jours, une case par nuit.
 * C'est le seul endroit du panneau qui porte de la couleur : le niveau de
 * prix (teinte de l'accent) ou l'état d'une nuit dans le plan.
 *
 * `cells` associe une date ISO à `{ level?, state?, flags?, title? }` :
 * - `level` entre 0 et 1, quantifié en cinq paliers du jaune au rouge ;
 * - `state` parmi ok, diff, custom, pending, next, busy, error, unknown : la couleur de fond ;
 * - `flags` parmi reserved, blocked, past : des marques qui se superposent
 *   à la couleur (hachures, atténuation) sans la remplacer ;
 * - `title` est l'infobulle de la case, affichée par la grille elle-même ;
 * - `selectable` : la nuit peut être choisie au clic ou au glisser, quand la
 *   grille a un `onSelect`.
 */
import { eachDay, yearBounds, weekday, t, currentLocale } from '../core/index.js';

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
        cell.dataset.tip = spec.title;
    }
    if (spec.selectable) {
        cell.dataset.selectable = '';
    }
}

/**
 * Sélection de nuits : un clic choisit ou retire une nuit, un glisser étend
 * le geste à toutes les nuits entre la première touchée et la nuit courante,
 * dans l'ordre du calendrier. Seules les cases `selectable` comptent.
 */
const selections = new WeakMap();

function attachSelection(el, index, onSelect) {
    selections.get(el)?.abort();
    const controller = new AbortController();
    selections.set(el, controller);
    const { signal } = controller;
    const dates = [...index.keys()];
    const position = new Map(dates.map((date, i) => [date, i]));
    const selected = () => dates.filter((date) => 'selected' in index.get(date).dataset);
    const cellAt = (event) => {
        const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell[data-selectable]');
        return cell && cell.parentElement === el ? cell : null;
    };
    let drag = null;
    const paint = (current) => {
        const [a, b] = [position.get(drag.anchor), position.get(current)].sort((x, y) => x - y);
        const next = new Set(drag.base);
        for (const date of dates.slice(a, b + 1)) {
            if ('selectable' in index.get(date).dataset) {
                next[drag.adding ? 'add' : 'delete'](date);
            }
        }
        for (const date of dates) {
            index.get(date).toggleAttribute('data-selected', next.has(date));
        }
    };
    el.addEventListener('pointerdown', (event) => {
        const cell = event.button === 0 ? cellAt(event) : null;
        if (!cell) {
            return;
        }
        event.preventDefault();
        const anchor = cell.dataset.date;
        const base = new Set(selected());
        drag = { anchor, base, adding: !base.has(anchor) };
        el.setPointerCapture(event.pointerId);
        paint(anchor);
    }, { signal });
    el.addEventListener('pointermove', (event) => {
        const cell = drag ? cellAt(event) : null;
        if (cell) {
            paint(cell.dataset.date);
        }
    }, { signal });
    const end = () => {
        if (drag) {
            drag = null;
            onSelect(selected());
        }
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    return {
        selected,
        clear() {
            for (const date of dates) {
                delete index.get(date).dataset.selected;
            }
        },
    };
}

/**
 * Infobulle de la grille : un seul élément par grille, affiché sans délai
 * au survol d'une case, au-dessus d'elle (ou dessous sur la première ligne).
 */
const withTooltip = new WeakSet();

function attachTooltip(el) {
    const tip = document.createElement('span');
    tip.className = 'grid-tip';
    tip.hidden = true;
    el.append(tip);
    if (withTooltip.has(el)) {
        return;
    }
    withTooltip.add(el);
    el.addEventListener('pointerover', (event) => {
        const current = el.querySelector(':scope > .grid-tip');
        const cell = event.target.closest('.cell[data-tip]');
        if (!current || !cell || cell.parentElement !== el) {
            if (current) {
                current.hidden = true;
            }
            return;
        }
        current.textContent = cell.dataset.tip;
        current.hidden = false;
        const half = current.offsetWidth / 2;
        const x = Math.min(Math.max(cell.offsetLeft + cell.offsetWidth / 2, half), el.clientWidth - half);
        const above = cell.offsetTop > current.offsetHeight + 8;
        current.style.left = `${x}px`;
        current.style.top = above ? `${cell.offsetTop - 6}px` : `${cell.offsetTop + cell.offsetHeight + 6}px`;
        current.classList.toggle('below', !above);
    });
    el.addEventListener('pointerleave', () => {
        const current = el.querySelector(':scope > .grid-tip');
        if (current) {
            current.hidden = true;
        }
    });
}
const LEVELS = 5;

/**
 * `legend` liste des entrées `{ label, state?, level?, flags? }` rendues comme
 * une case, ou `{ scale: [min, max], label? }` : une réglette des cinq paliers
 * de prix. Avec `onSelect`, les nuits `selectable` se choisissent au clic ou
 * au glisser et la fonction reçoit les dates choisies à chaque geste.
 */
export function renderYearGrid(el, year, cells, { legend = [], onSelect = null } = {}) {
    el.innerHTML = '';
    el.hidden = false;
    el.classList.toggle('selectable', Boolean(onSelect));
    attachTooltip(el);
    const { from, to } = yearBounds(year);
    const index = new Map();
    let month = -1;
    for (const date of eachDay(from, to)) {
        const m = Number(date.slice(5, 7)) - 1;
        if (m !== month) {
            month = m;
            const label = document.createElement('span');
            label.className = 'month';
            label.textContent = t(`month_${m + 1}`);
            label.style.gridColumn = '1';
            label.style.gridRow = String(m + 1);
            el.append(label);
        }
        const cell = document.createElement('i');
        cell.className = 'cell';
        cell.dataset.date = date;
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
                // Échelle de prix : les cinq paliers, du jaune (plus bas) au rouge (plus haut).
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
                li.title = t('legend_scale_title', min, max);
                li.append(document.createTextNode(`${min} €`), strip, document.createTextNode(`${max} €${item.label ? ` ${item.label}` : ''}`));
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
    const selection = onSelect ? attachSelection(el, index, onSelect) : null;
    return {
        /** Change la couleur d'état ; `selectable: false` retire la nuit de la sélection et des nuits choisissables. */
        setState(date, state, { selectable = true } = {}) {
            const cell = index.get(date);
            if (!cell) {
                return;
            }
            cell.dataset.state = state;
            if (!selectable) {
                delete cell.dataset.selectable;
                delete cell.dataset.selected;
            }
        },
        selected: () => selection?.selected() ?? [],
        clearSelection: () => selection?.clear(),
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
            for (const key of ['level', 'state', 'selectable', 'selected', ...FLAGS]) {
                delete cell.dataset[key];
            }
            delete cell.dataset.tip;
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

export function describeDate(date) {
    return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
