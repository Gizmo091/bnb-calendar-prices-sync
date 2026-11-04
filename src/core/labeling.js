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

/** Nuit du samedi : 'sat', le reste : 'wk'. */
export function dayTypeOf(iso) {
    return weekday(iso) === 6 ? 'sat' : 'wk';
}

/** Saisons sans vacances scolaires, distinguées par les vacances qui les encadrent. */
export const GAP_SEASONS = new Set(['none', 'ferie']);

const SEASON_NAMES = {
    none: 'Hors vacances',
    ferie: 'Jour férié',
    noel: 'Vacances de Noël',
    hiver: "Vacances d'hiver",
    printemps: 'Vacances de printemps',
    ete: "Vacances d'été",
    toussaint: 'Vacances de la Toussaint',
    ascension: "Pont de l'Ascension",
};

const SHORT_NAMES = {
    noel: 'Noël',
    hiver: 'hiver',
    printemps: 'printemps',
    ete: 'été',
    toussaint: 'Toussaint',
    ascension: 'Ascension',
    start: 'début',
    end: 'fin',
};

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

export function labelDay(iso, ctx) {
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
        dayType: dayTypeOf(iso),
        publicHoliday,
    };
}

export function ruleKey(label) {
    const scope = label.gap ?? (label.zones.join('') || '-');
    return `${label.season}|${scope}|${label.dayType}`;
}

export function parseRuleKey(key) {
    const [season, scope, dayType] = key.split('|');
    if (scope.includes('>')) {
        return { season, zones: [], gap: scope, dayType };
    }
    return { season, zones: scope === '-' ? [] : scope.split(''), gap: null, dayType };
}

/** @returns {Map<string, object>} date -> label */
export function labelYear(year, ctx) {
    const { from, to } = yearBounds(year);
    const labels = new Map();
    for (const d of eachDay(from, to)) {
        labels.set(d, labelDay(d, ctx));
    }
    return labels;
}

export function describeGap(gap) {
    const [before, after] = gap.split('>');
    return `entre ${SHORT_NAMES[before] ?? before} et ${SHORT_NAMES[after] ?? after}`;
}

export function describeRuleKey(key) {
    const { season, zones, gap, dayType } = parseRuleKey(key);
    const parts = [SEASON_NAMES[season] ?? season];
    if (zones.length) {
        parts.push(`zone${zones.length > 1 ? 's' : ''} ${zones.join('+')}`);
    }
    if (gap) {
        parts.push(describeGap(gap));
    }
    parts.push(dayType === 'sat' ? 'samedi' : 'autres jours');
    return parts.join(' · ');
}
