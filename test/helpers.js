import { readFileSync } from 'node:fs';
import { buildCalendarContext } from '../src/core/holidays.js';

export function fixture(name) {
    return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/** Faux fetch servant les fixtures selon l'URL : open data français ou OpenHolidays. */
export function fakeFetch(url) {
    const u = new URL(url);
    let name;
    if (u.hostname === 'calendrier.api.gouv.fr') {
        name = `public-${u.pathname.match(/(\d{4})\.json$/)[1]}`;
    }
    else if (u.hostname === 'data.education.gouv.fr') {
        const sy = u.searchParams.get('where').match(/"(\d{4}-\d{4})"/)[1];
        name = `school-${sy}${u.searchParams.get('offset') === '100' ? '-p2' : ''}`;
    }
    else {
        const kind = u.pathname.endsWith('/SchoolHolidays') ? 'school' : 'public';
        name = `openholidays-${u.searchParams.get('countryIsoCode')}-${kind}-${u.searchParams.get('validFrom').slice(0, 4)}`;
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fixture(name)) });
}

/** Contexte calendaire français d'une année civile, construit depuis les fixtures. */
export function contextFor(year) {
    return buildCalendarContext(year, { countries: ['FR'], language: 'fr' }, fakeFetch);
}
