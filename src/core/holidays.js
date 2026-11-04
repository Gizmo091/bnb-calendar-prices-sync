/**
 * Récupération et normalisation des vacances scolaires françaises (zones A, B, C)
 * et des jours fériés, depuis les API publiques de l'État.
 *
 * Les périodes retournées sont exprimées en nuits : `start` inclus, `end` exclu.
 * Le jeu de données de l'Éducation nationale donne comme début le jour où les
 * cours s'arrêtent (en général un samedi) et comme fin le jour de la reprise,
 * ce qui correspond exactement aux nuits louées.
 */

export const SCHOOL_API = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';
export const PUBLIC_API = 'https://calendrier.api.gouv.fr/jours-feries/metropole';

export const ZONES = ['A', 'B', 'C'];

const PAGE_SIZE = 100;

const parisDate = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** L'API renvoie des instants UTC (« 2025-12-19T23:00:00+00:00 ») : on veut le jour civil en France. */
export function toParisDate(isoInstant) {
    return parisDate.format(new Date(isoInstant));
}

const SEASONS = [
    [/no[eë]l/i, 'noel'],
    [/hiver/i, 'hiver'],
    [/printemps/i, 'printemps'],
    [/[eé]t[eé]/i, 'ete'],
    [/toussaint/i, 'toussaint'],
    [/ascension/i, 'ascension'],
];

export function seasonOf(description) {
    for (const [re, season] of SEASONS) {
        if (re.test(description ?? '')) {
            return season;
        }
    }
    return null;
}

/** Les deux années scolaires qui couvrent une année civile. */
export function schoolYearsFor(year) {
    return [`${year - 1}-${year}`, `${year}-${year + 1}`];
}

/**
 * Transforme les enregistrements bruts de l'API en périodes dédupliquées.
 * L'API renvoie une ligne par académie : on ne garde qu'une ligne par
 * (saison, zone, début, fin).
 */
export function normalizeSchoolRecords(records) {
    const seen = new Map();
    for (const r of records) {
        const season = seasonOf(r.description);
        const zone = /^Zone ([ABC])$/.exec(r.zones ?? '')?.[1];
        const population = r.population ?? '-';
        if (!season || !zone || !r.start_date || !r.end_date) {
            continue;
        }
        if (population !== '-' && !/élèves/i.test(population)) {
            continue;
        }
        const start = toParisDate(r.start_date);
        const end = toParisDate(r.end_date);
        if (end <= start) {
            continue;
        }
        const key = `${season}|${zone}|${start}|${end}`;
        if (!seen.has(key)) {
            seen.set(key, { season, zone, start, end });
        }
    }
    return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone));
}

export async function fetchSchoolHolidays(year, fetchImpl = globalThis.fetch) {
    const records = [];
    for (const schoolYear of schoolYearsFor(year)) {
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const url = new URL(SCHOOL_API);
            url.searchParams.set('where', `annee_scolaire="${schoolYear}" and zones in ("Zone A","Zone B","Zone C")`);
            url.searchParams.set('limit', String(PAGE_SIZE));
            url.searchParams.set('offset', String(offset));
            const response = await fetchImpl(url.toString());
            if (!response.ok) {
                throw new Error(`Calendrier scolaire ${schoolYear} : HTTP ${response.status}`);
            }
            const body = await response.json();
            const page = body.results ?? [];
            records.push(...page);
            if (page.length < PAGE_SIZE) {
                break;
            }
        }
    }
    return normalizeSchoolRecords(records);
}

export async function fetchPublicHolidays(year, fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(`${PUBLIC_API}/${year}.json`);
    if (!response.ok) {
        throw new Error(`Jours fériés ${year} : HTTP ${response.status}`);
    }
    return await response.json();
}

/**
 * Contexte calendaire complet pour une année civile.
 * @returns {{ year:number, schoolPeriods:Array, publicHolidays:Object }}
 */
export async function buildCalendarContext(year, fetchImpl = globalThis.fetch) {
    const [schoolPeriods, publicHolidays] = await Promise.all([
        fetchSchoolHolidays(year, fetchImpl),
        fetchPublicHolidays(year, fetchImpl),
    ]);
    return { year, schoolPeriods, publicHolidays };
}
