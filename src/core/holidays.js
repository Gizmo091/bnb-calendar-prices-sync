/**
 * Vacances scolaires et jours fériés, par pays. Les périodes sont exprimées en
 * nuits : `start` inclus, `end` exclu. Chaque période porte une `zone`, le
 * code de la région concernée, et une `season`, l'identifiant de la saison.
 *
 * France : l'open data de l'État (calendrier scolaire de l'Éducation nationale,
 * zones A, B, C, et jours fériés), publié jusqu'à trois ans d'avance, avec les
 * identifiants de saison historiques (noel, hiver, printemps, ete, toussaint,
 * ascension) que l'extension sait traduire.
 *
 * Autres pays : l'OpenHolidays API (openholidaysapi.org), une source libre
 * pour une trentaine de pays européens avec leurs subdivisions. La saison
 * est le nom de la période dans la langue du pays, normalisé ; `seasonNames`
 * donne le nom à afficher dans la langue de l'interface.
 */
import { addDays } from './dates.js';
import { t } from './i18n.js';

/* ---------- France : open data de l'État ---------- */

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

const FR_SEASONS = [
    [/no[eë]l/i, 'noel'],
    [/hiver/i, 'hiver'],
    [/printemps/i, 'printemps'],
    [/[eé]t[eé]/i, 'ete'],
    [/toussaint/i, 'toussaint'],
    [/ascension/i, 'ascension'],
];

export function seasonOf(description) {
    for (const [re, season] of FR_SEASONS) {
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
                throw new Error(t('err_holidays_http', 'FR', response.status));
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
        throw new Error(t('err_holidays_http', 'FR', response.status));
    }
    return await response.json();
}


/* ---------- Autres pays : OpenHolidays API ---------- */

export const OPEN_HOLIDAYS_API = 'https://openholidaysapi.org';

/** Pays servis, pour le choix dans les réglages ; la France passe par sa propre source. */
export const COUNTRIES = ['AD', 'AL', 'AT', 'BE', 'BG', 'BR', 'BY', 'CH', 'CZ', 'DE', 'EE', 'ES', 'FR', 'HR', 'HU', 'IE', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'MT', 'MX', 'NL', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'VA', 'ZA'];
export const DEFAULT_COUNTRIES = ['FR'];
/** Première langue officielle de chaque pays : celle qui nomme les saisons, pour un identifiant stable. */
export const COUNTRY_LANGUAGE = { AD: 'CA', AL: 'SQ', AT: 'DE', BE: 'FR', BG: 'BG', BR: 'PT', BY: 'BE', CH: 'DE', CZ: 'CS', DE: 'DE', EE: 'ET', ES: 'ES', FR: 'FR', HR: 'HR', HU: 'HU', IE: 'EN', IT: 'IT', LI: 'DE', LT: 'LT', LU: 'FR', LV: 'LV', MC: 'FR', MD: 'RO', MT: 'EN', MX: 'ES', NL: 'NL', PL: 'PL', PT: 'PT', RO: 'RO', RS: 'SR', SE: 'SV', SI: 'SL', SK: 'SK', SM: 'IT', VA: 'IT', ZA: 'EN' };

/** Identifiant stable d'une saison : le nom, sans accents ni ponctuation. */
export function slugify(name) {
    return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Nom dans la langue demandée, sinon dans la langue de repli, sinon le premier disponible. */
export function nameIn(names, language, fallbackLanguage = null) {
    const pick = (lang) => names?.find((n) => n.language === String(lang ?? '').slice(0, 2).toUpperCase())?.text;
    return pick(language) ?? pick(fallbackLanguage) ?? names?.[0]?.text ?? '';
}

/**
 * Transforme les vacances scolaires brutes de l'API en périodes : une par
 * subdivision citée, ou une seule sur le code du pays quand la période est
 * nationale. La saison vient du nom dans la langue du pays.
 * @returns {{ periods: Array<{season:string,zone:string,start:string,end:string}>, seasonNames: Object<string,string> }}
 */
export function normalizeOpenSchoolHolidays(records, country, { language = 'en', countryLanguage = COUNTRY_LANGUAGE[country] } = {}) {
    const seen = new Map();
    const seasonNames = {};
    for (const r of records) {
        if (!r.startDate || !r.endDate || r.endDate < r.startDate) {
            continue;
        }
        const season = slugify(nameIn(r.name, countryLanguage, language));
        if (!season) {
            continue;
        }
        seasonNames[season] = nameIn(r.name, language, countryLanguage);
        const end = addDays(r.endDate, 1);
        const codes = (r.subdivisions ?? []).map((s) => s.code);
        const zones = r.nationwide || codes.length === 0 ? [country] : codes;
        for (const zone of zones) {
            const key = `${season}|${zone}|${r.startDate}|${end}`;
            if (!seen.has(key)) {
                seen.set(key, { season, zone, start: r.startDate, end });
            }
        }
    }
    return { periods: [...seen.values()], seasonNames };
}

/** Jours fériés nationaux : date -> nom dans la langue de l'interface. Les fêtes régionales sont laissées de côté. */
export function normalizeOpenPublicHolidays(records, { language = 'en', countryLanguage = null } = {}) {
    const days = {};
    for (const r of records) {
        if (r.nationwide === false || !r.startDate) {
            continue;
        }
        days[r.startDate] = nameIn(r.name, language, countryLanguage);
    }
    return days;
}

async function fetchOpenJson(path, params, country, fetchImpl) {
    const url = new URL(path, OPEN_HOLIDAYS_API);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }
    const response = await fetchImpl(url.toString(), { headers: { accept: 'text/json' } });
    if (!response.ok) {
        throw new Error(t('err_holidays_http', country, response.status));
    }
    return await response.json();
}

/** Vacances et fériés d'un pays sur une année civile, périodes à cheval comprises. */
export async function fetchOpenHolidays(country, year, { language = 'en' } = {}, fetchImpl = globalThis.fetch) {
    const range = { countryIsoCode: country, validFrom: `${year}-01-01`, validTo: `${year}-12-31` };
    const [school, pub] = await Promise.all([
        fetchOpenJson('/SchoolHolidays', range, country, fetchImpl),
        fetchOpenJson('/PublicHolidays', range, country, fetchImpl),
    ]);
    const countryLanguage = COUNTRY_LANGUAGE[country];
    const { periods, seasonNames } = normalizeOpenSchoolHolidays(school, country, { language, countryLanguage });
    return { periods, seasonNames, publicHolidays: normalizeOpenPublicHolidays(pub, { language, countryLanguage }) };
}

/* ---------- Contexte ---------- */

async function fetchCountry(country, year, language, fetchImpl) {
    if (country === 'FR') {
        const [periods, publicHolidays] = await Promise.all([fetchSchoolHolidays(year, fetchImpl), fetchPublicHolidays(year, fetchImpl)]);
        return { periods, publicHolidays, seasonNames: {} };
    }
    return fetchOpenHolidays(country, year, { language }, fetchImpl);
}

/**
 * Contexte calendaire complet pour une année civile, sur un ou plusieurs
 * pays : les périodes de tous les pays réunies et triées, les fériés fusionnés.
 * @returns {{ year:number, countries:string[], schoolPeriods:Array, publicHolidays:Object, seasonNames:Object }}
 */
export async function buildCalendarContext(year, { countries = DEFAULT_COUNTRIES, language = 'en' } = {}, fetchImpl = globalThis.fetch) {
    const parts = await Promise.all(countries.map((country) => fetchCountry(country, year, language, fetchImpl)));
    return {
        year,
        countries: [...countries],
        schoolPeriods: parts.flatMap((p) => p.periods).sort((a, b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone)),
        publicHolidays: Object.assign({}, ...parts.map((p) => p.publicHolidays)),
        seasonNames: Object.assign({}, ...parts.map((p) => p.seasonNames)),
    };
}
