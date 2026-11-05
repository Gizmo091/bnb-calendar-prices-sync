/**
 * Inférence des règles tarifaires d'une année de référence, puis génération
 * des prix d'une année cible à partir de ces règles.
 */
import { labelYear, ruleKey, parseRuleKey } from './labeling.js';

/** Valeur la plus fréquente ; en cas d'égalité, la plus élevée. */
export function mode(values) {
    const counts = new Map();
    for (const v of values) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best = null;
    for (const [value, count] of counts) {
        if (best === null || count > best.count || (count === best.count && value > best.value)) {
            best = { value, count };
        }
    }
    return best;
}

/**
 * @param {Object<string,{price:number,custom?:boolean}>} days prix observés
 * @param {Map<string,object>} labels étiquettes de ces mêmes dates
 * @returns {Object<string,{price:number,samples:number,share:number}>}
 */
export function inferRules(days, labels) {
    const groups = new Map();
    for (const [date, label] of labels) {
        const day = days[date];
        if (!day || typeof day.price !== 'number') {
            continue;
        }
        const key = ruleKey(label);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(day.price);
    }
    const rules = {};
    for (const [key, prices] of groups) {
        const m = mode(prices);
        rules[key] = { price: m.value, samples: prices.length, share: m.count / prices.length };
    }
    return rules;
}

function overlap(a, b) {
    return a.filter((z) => b.includes(z)).length;
}

function found(rules, key, source) {
    return rules[key] ? { price: rules[key].price, source, rule: key } : null;
}

/** Règle de vacances la plus proche : même saison, même type de jour, zones les plus proches. */
function closestHolidayRule(rules, label, dayType) {
    let best = null;
    for (const key of Object.keys(rules)) {
        const parsed = parseRuleKey(key);
        if (parsed.season !== label.season || parsed.dayType !== dayType || parsed.gap) {
            continue;
        }
        const score = overlap(parsed.zones, label.zones) * 10 - Math.abs(parsed.zones.length - label.zones.length);
        if (!best || score > best.score) {
            best = { key, score };
        }
    }
    return best?.key ?? null;
}

/**
 * Règle hors vacances la plus proche d'une période : mêmes vacances
 * précédentes, sinon mêmes vacances suivantes, sinon la plus fournie.
 */
function closestGapRule(rules, gap, dayType) {
    const [before, after] = gap.split('>');
    let best = null;
    for (const key of Object.keys(rules)) {
        const parsed = parseRuleKey(key);
        if (parsed.season !== 'none' || parsed.dayType !== dayType || !parsed.gap) {
            continue;
        }
        const [b, a] = parsed.gap.split('>');
        const score = (b === before ? 2 : 0) + (a === after ? 1 : 0);
        const samples = rules[key].samples ?? 0;
        if (!best || score > best.score || (score === best.score && samples > best.samples)) {
            best = { key, score, samples };
        }
    }
    return best?.key ?? null;
}

/**
 * Résolution d'un prix pour une étiquette, avec repli progressif :
 * 1. règle exacte
 * 2. vacances : même saison, zones les plus proches (type de jour puis « autres jours »)
 * 3. hors vacances encadrant la période : mêmes bornes, sinon bornes voisines
 * 4. prix de base
 */
export function resolvePrice(label, rules, basePrice) {
    const exact = found(rules, ruleKey(label), 'exact');
    if (exact) {
        return exact;
    }
    const dayTypes = label.dayType === 'wk' ? ['wk'] : [label.dayType, 'wk'];
    if (!label.gap) {
        for (const dayType of dayTypes) {
            const key = closestHolidayRule(rules, label, dayType);
            if (key) {
                return found(rules, key, 'season');
            }
        }
    }
    const gaps = label.gap
        ? [label.gap]
        : [`${label.before}>${label.season}`, `${label.season}>${label.after}`];
    for (const dayType of dayTypes) {
        for (const gap of gaps) {
            const direct = found(rules, `none|${gap}|${dayType}`, 'offseason');
            if (direct) {
                return direct;
            }
        }
    }
    for (const dayType of dayTypes) {
        const key = closestGapRule(rules, gaps[0], dayType);
        if (key) {
            return found(rules, key, 'offseason');
        }
    }
    return { price: basePrice, source: 'base', rule: null };
}

/**
 * Génère les prix d'une année à partir des règles.
 * @returns {Object<string,{price:number,source:string,rule:string|null}>}
 */
export function generateYear(year, rules, ctx, basePrice, options = {}) {
    const out = {};
    for (const [date, label] of labelYear(year, ctx, options)) {
        out[date] = resolvePrice(label, rules, basePrice);
    }
    return out;
}
