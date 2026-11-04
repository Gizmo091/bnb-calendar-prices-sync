/**
 * Manipulation de dates au format ISO "YYYY-MM-DD", en UTC pour éviter
 * toute dérive liée aux changements d'heure.
 */

export function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date) {
    return date.toISOString().slice(0, 10);
}

export function isISODate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toISO(parseISO(value)) === value;
}

export function addDays(iso, n) {
    const d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
}

export function addMonths(iso, n) {
    const d = parseISO(iso);
    d.setUTCMonth(d.getUTCMonth() + n);
    return toISO(d);
}

/** Itère chaque jour de `from` à `to`, bornes incluses. */
export function* eachDay(from, to) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
        yield d;
    }
}

/** 0 = dimanche … 6 = samedi */
export function weekday(iso) {
    return parseISO(iso).getUTCDay();
}

export function yearOf(iso) {
    return Number(iso.slice(0, 4));
}

export function yearBounds(year) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function today() {
    return toISO(new Date());
}
