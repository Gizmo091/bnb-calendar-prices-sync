import { addDays, weekday } from './dates.js';

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_LABELS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Regroupe une table date -> prix en plages contiguës de même prix,
 * ce qui réduit le nombre d'opérations à effectuer dans l'interface du site.
 * @param {Object<string,number>} prices
 * @returns {Array<{from:string,to:string,price:number,nights:number}>}
 */
export function toRanges(prices) {
    const dates = Object.keys(prices).sort();
    const ranges = [];
    let current = null;
    for (const date of dates) {
        const price = prices[date];
        if (current && current.price === price && addDays(current.to, 1) === date) {
            current.to = date;
            current.nights += 1;
        }
        else {
            current = { from: date, to: date, price, nights: 1 };
            ranges.push(current);
        }
    }
    return ranges;
}

/**
 * Regroupe en périodes à motif hebdomadaire constant : sur toute la période,
 * chaque jour de la semaine garde le même prix. Une période où tous les jours
 * ont le même prix reste une plage simple (`price`) ; sinon elle porte
 * `byWeekday` (nom anglais du jour -> prix), pour les sites qui enregistrent
 * un tarif par nuit de la semaine en une seule opération.
 * @param {Object<string,number>} prices
 */
export function toWeekdayRanges(prices) {
    const dates = Object.keys(prices).sort();
    const periods = [];
    let current = null;
    for (const date of dates) {
        const wd = weekday(date);
        const price = prices[date];
        const fits = current && addDays(current.to, 1) === date
            && (current.pattern[wd] === undefined || current.pattern[wd] === price);
        if (fits) {
            current.to = date;
            current.nights += 1;
            current.pattern[wd] = price;
        }
        else {
            current = { from: date, to: date, nights: 1, pattern: { [wd]: price } };
            periods.push(current);
        }
    }
    return periods.map(({ from, to, nights, pattern }) => {
        const values = [...new Set(Object.values(pattern))];
        if (values.length === 1) {
            return { from, to, nights, price: values[0] };
        }
        const byWeekday = {};
        for (const wd of WEEK_ORDER) {
            if (pattern[wd] !== undefined) {
                byWeekday[WEEKDAY_NAMES[wd]] = pattern[wd];
            }
        }
        return { from, to, nights, price: null, byWeekday };
    });
}

/** Prix qu'une opération attribue à une nuit donnée. */
export function priceForDate(op, date) {
    if (!op.byWeekday) {
        return op.price;
    }
    return op.byWeekday[WEEKDAY_NAMES[weekday(date)]] ?? null;
}

/** Résumé lisible du prix d'une opération : « 178 » ou « lun/mar/… 178 · sam 355 ». */
export function describeOp(op) {
    if (!op.byWeekday) {
        return String(op.price);
    }
    const groups = new Map();
    for (const wd of WEEK_ORDER) {
        const price = op.byWeekday[WEEKDAY_NAMES[wd]];
        if (price === undefined) {
            continue;
        }
        if (!groups.has(price)) {
            groups.set(price, []);
        }
        groups.get(price).push(WEEKDAY_LABELS[wd]);
    }
    return [...groups].map(([price, days]) => `${days.join('/')} ${price}`).join(' · ');
}
