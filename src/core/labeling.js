/**
 * Étiquetage des nuits : chaque jour reçoit une saison (vacances scolaires ou
 * hors vacances), les zones concernées et un type de jour. C'est cette
 * étiquette, et non la date, qui sert de pivot pour reporter les prix d'une
 * année sur l'autre.
 *
 * Hors vacances, la période est définie par les vacances qui l'encadrent :
 * « entre Noël et hiver », « entre été et Toussaint »… Ces périodes se
 * retrouvent chaque année, même si leurs dates bougent.
 */
import { eachDay, weekday, yearBounds } from './dates.js';
import { t } from './i18n.js';

/** Codes des jours de la semaine, indexés comme `weekday` (0 = dimanche). */
export const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Par défaut, seul le samedi a un tarif propre. */
export const DEFAULT_SPECIAL_DAYS = [6];

/**
 * Type de jour : le code du jour s'il a un tarif propre (`specialDays`, numéros
 * de jour comme `weekday`), sinon 'wk' pour « les autres jours ».
 */
export function dayTypeOf(iso, specialDays = DEFAULT_SPECIAL_DAYS) {
    const day = weekday(iso);
    return specialDays.includes(day) ? DAY_CODES[day] : 'wk';
}

/** Saisons sans vacances scolaires, distinguées par les vacances qui les encadrent. */
export const GAP_SEASONS = new Set(['none', 'ferie']);

const SEASONS = ['none', 'ferie', 'noel', 'hiver', 'printemps', 'ete', 'toussaint', 'ascension'];
const SHORT = ['noel', 'hiver', 'printemps', 'ete', 'toussaint', 'ascension', 'start', 'end'];

/**
 * Vacances précédentes et suivantes d'une nuit, toutes zones confondues.
 * Pour une nuit de vacances, on cherche les vacances d'une autre saison.
 */
export function neighbours(iso, periods, season = null) {
    let before = null;
    let after = null;
    for (const p of periods) {
        if (season && p.season === season) {
            continue;
        }
        if (p.end <= iso && (!before || p.end > before.end)) {
            before = p;
        }
        if (p.start > iso && (!after || p.start < after.start)) {
            after = p;
        }
    }
    return { before: before?.season ?? 'start', after: after?.season ?? 'end' };
}

export function labelDay(iso, ctx, { specialDays = DEFAULT_SPECIAL_DAYS } = {}) {
    const zones = new Set();
    let season = null;
    for (const p of ctx.schoolPeriods) {
        if (iso >= p.start && iso < p.end) {
            season ??= p.season;
            if (p.season === season) {
                zones.add(p.zone);
            }
        }
    }
    const publicHoliday = ctx.publicHolidays?.[iso] ?? null;
    if (!season && publicHoliday) {
        season = 'ferie';
    }
    season ??= 'none';
    const { before, after } = neighbours(iso, ctx.schoolPeriods, GAP_SEASONS.has(season) ? null : season);
    return {
        season,
        zones: [...zones].sort(),
        before,
        after,
        gap: GAP_SEASONS.has(season) ? `${before}>${after}` : null,
        dayType: dayTypeOf(iso, specialDays),
        publicHoliday,
    };
}

export function ruleKey(label) {
    const scope = label.gap ?? (label.zones.join('+') || '-');
    return `${label.season}|${scope}|${label.dayType}`;
}

export function parseRuleKey(key) {
    const [season, scope, dayType] = key.split('|');
    if (scope.includes('>')) {
        return { season, zones: [], gap: scope, dayType };
    }
    return { season, zones: scope === '-' ? [] : scope.split('+'), gap: null, dayType };
}

/** @returns {Map<string, object>} date -> label */
export function labelYear(year, ctx, options = {}) {
    const { from, to } = yearBounds(year);
    const labels = new Map();
    for (const d of eachDay(from, to)) {
        labels.set(d, labelDay(d, ctx, options));
    }
    return labels;
}

export function describeDayType(dayType) {
    const index = DAY_CODES.indexOf(dayType);
    return index === -1 ? t('other_days') : t(`day_${index}`);
}

/** Nom d'une saison : traduit pour les saisons françaises, sinon celui fourni par la source. */
export function describeSeason(season, names = {}) {
    return SEASONS.includes(season) ? t(`season_${season}`) : names[season] ?? season;
}

export function describeGap(gap, names = {}) {
    const [before, after] = gap.split('>');
    const short = (name) => (SHORT.includes(name) ? t(`short_${name}`) : names[name] ?? name);
    return t('gap_between', short(before), short(after));
}

/** Libellé d'une règle ; `names` donne le nom des saisons hors France. Les codes ISO de région perdent leur préfixe pays. */
export function describeRuleKey(key, names = {}) {
    const { season, zones, gap, dayType } = parseRuleKey(key);
    const parts = [describeSeason(season, names)];
    if (zones.length) {
        parts.push(t(zones.length > 1 ? 'zone_many' : 'zone_one', zones.map((z) => z.replace(/^[A-Z]{2}-/, '')).join('+')));
    }
    if (gap) {
        parts.push(describeGap(gap, names));
    }
    parts.push(describeDayType(dayType));
    return parts.join(' · ');
}
