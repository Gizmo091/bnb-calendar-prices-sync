import { toRanges, toWeekdayRanges } from './ranges.js';

/**
 * Compare les prix actuels aux prix proposés et ne retient que les nuits
 * encore au prix de base : un prix déjà personnalisé n'est jamais écrasé,
 * sauf demande explicite.
 *
 * Une nuit est considérée comme personnalisée si le site l'indique (`custom`)
 * ou, à défaut, si son prix diffère du prix de base. Une nuit réservée
 * (`reserved`) ne peut plus être tarifée et reste telle quelle.
 *
 * Avec `weekdayPattern`, les opérations sont des périodes à motif hebdomadaire
 * (voir `toWeekdayRanges`), bien moins nombreuses que les plages simples.
 * Les nuits antérieures à `notBefore` (en général la date du jour) sont
 * écartées et seulement comptées.
 *
 * @param {Object<string,{price:number,custom?:boolean}>} current
 * @param {Object<string,{price:number}>} proposed
 */
export function planUpdates(current, proposed, { basePrice, overwriteCustom = false, weekdayPattern = false, notBefore = null } = {}) {
    const toApply = {};
    const skipped = [];
    let unchanged = 0;
    let past = 0;
    for (const [date, next] of Object.entries(proposed)) {
        if (notBefore && date < notBefore) {
            past += 1;
            continue;
        }
        const cur = current[date];
        if (!cur || typeof cur.price !== 'number') {
            skipped.push({ date, reason: 'unknown' });
            continue;
        }
        if (cur.price === next.price) {
            unchanged += 1;
            continue;
        }
        if (cur.reserved) {
            skipped.push({ date, reason: 'reserved', current: cur.price, proposed: next.price });
            continue;
        }
        const isCustom = typeof cur.custom === 'boolean' ? cur.custom : cur.price !== basePrice;
        if (isCustom && !overwriteCustom) {
            skipped.push({ date, reason: 'custom', current: cur.price, proposed: next.price });
            continue;
        }
        toApply[date] = next.price;
    }
    const ops = weekdayPattern ? toWeekdayRanges(toApply) : toRanges(toApply);
    return { ops, skipped, unchanged, past, changed: Object.keys(toApply).length };
}
