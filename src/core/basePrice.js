import { addMonths, today } from './dates.js';
import { mode } from './rules.js';

/**
 * Détecte le prix de base : le prix le plus fréquent sur les nuits lointaines,
 * que l'hôte n'a en général pas encore personnalisées.
 * @returns {{price:number|null, samples:number, share:number}}
 */
export function detectBasePrice(days, { horizonMonths = 18, from = today() } = {}) {
    const threshold = addMonths(from, horizonMonths);
    const prices = Object.entries(days)
        .filter(([date, d]) => date >= threshold && typeof d.price === 'number')
        .map(([, d]) => d.price);
    if (!prices.length) {
        return { price: null, samples: 0, share: 0 };
    }
    const m = mode(prices);
    return { price: m.value, samples: prices.length, share: m.count / prices.length };
}
