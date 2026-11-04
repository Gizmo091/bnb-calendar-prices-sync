import { readFileSync } from 'node:fs';
import { normalizeSchoolRecords } from '../src/core/holidays.js';

export function fixture(name) {
    return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/** Contexte calendaire d'une année civile, construit depuis les fixtures. */
export function contextFor(year) {
    const records = [];
    for (const sy of [`${year - 1}-${year}`, `${year}-${year + 1}`]) {
        for (const suffix of ['', '-p2']) {
            try {
                records.push(...fixture(`school-${sy}${suffix}`).results);
            }
            catch {
                // fixture absente : année scolaire non couverte
            }
        }
    }
    return { year, schoolPeriods: normalizeSchoolRecords(records), publicHolidays: fixture(`public-${year}`) };
}

/** Faux fetch servant les fixtures selon l'URL demandée. */
export function fakeFetch(url) {
    const u = new URL(url);
    let name;
    if (u.hostname === 'calendrier.api.gouv.fr') {
        name = `public-${u.pathname.match(/(\d{4})\.json$/)[1]}`;
    }
    else {
        const sy = u.searchParams.get('where').match(/"(\d{4}-\d{4})"/)[1];
        name = `school-${sy}${u.searchParams.get('offset') === '100' ? '-p2' : ''}`;
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fixture(name)) });
}
