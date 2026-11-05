import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup.js';
import { normalizeSchoolRecords, toParisDate, fetchSchoolHolidays, fetchPublicHolidays, seasonOf, slugify, nameIn, normalizeOpenSchoolHolidays, normalizeOpenPublicHolidays, buildCalendarContext } from '../src/core/holidays.js';
import { fixture, fakeFetch } from './helpers.js';

test('toParisDate ramène un instant UTC au jour civil français', () => {
    assert.equal(toParisDate('2025-12-19T23:00:00+00:00'), '2025-12-20');
    assert.equal(toParisDate('2026-07-03T22:00:00+00:00'), '2026-07-04');
});

test('seasonOf reconnaît les libellés de l\'API', () => {
    assert.equal(seasonOf("Vacances d'Hiver"), 'hiver');
    assert.equal(seasonOf('Vacances de Noël'), 'noel');
    assert.equal(seasonOf("Pont de l'Ascension"), 'ascension');
    assert.equal(seasonOf('Début des Vacances d\'Été'), 'ete');
    assert.equal(seasonOf('Rentrée scolaire des enseignants'), null);
});

test('normalizeSchoolRecords déduplique les académies et fixe les bornes', () => {
    const records = [...fixture('school-2025-2026').results, ...fixture('school-2025-2026-p2').results];
    const periods = normalizeSchoolRecords(records);
    const noel = periods.filter((p) => p.season === 'noel');
    assert.equal(noel.length, 3, 'une période de Noël par zone');
    assert.deepEqual(noel.map((p) => p.zone), ['A', 'B', 'C']);
    assert.equal(noel[0].start, '2025-12-20');
    assert.equal(noel[0].end, '2026-01-05');
    const hiverA = periods.find((p) => p.season === 'hiver' && p.zone === 'A');
    assert.equal(hiverA.start, '2026-02-07');
    assert.equal(hiverA.end, '2026-02-23');
    for (const p of periods) {
        assert.ok(p.start < p.end, `${p.season} ${p.zone}`);
    }
});

test('fetchSchoolHolidays pagine et couvre les deux années scolaires', async () => {
    const periods = await fetchSchoolHolidays(2026, fakeFetch);
    const seasons = new Set(periods.map((p) => `${p.season}:${p.start.slice(0, 4)}`));
    assert.ok(seasons.has('hiver:2026'));
    assert.ok(seasons.has('toussaint:2026'));
    assert.ok(seasons.has('noel:2026'));
    assert.ok(seasons.has('noel:2025'));
});

test('fetchPublicHolidays', async () => {
    const days = await fetchPublicHolidays(2026, fakeFetch);
    assert.equal(days['2026-07-14'], '14 juillet');
});

test('slugify et nameIn', () => {
    assert.equal(slugify('Weihnachtsferien'), 'weihnachtsferien');
    assert.equal(slugify("Vacances d'été austral"), 'vacances-d-ete-austral');
    const names = [{ language: 'FR', text: 'Noël' }, { language: 'EN', text: 'Christmas' }];
    assert.equal(nameIn(names, 'en-US'), 'Christmas');
    assert.equal(nameIn(names, 'de', 'FR'), 'Noël');
    assert.equal(nameIn(names, 'de'), 'Noël');
});

test('OpenHolidays : une période par subdivision, saison nommée dans la langue du pays', () => {
    const records = [
        { startDate: '2026-07-27', endDate: '2026-09-07', name: [{ language: 'DE', text: 'Sommerferien' }, { language: 'EN', text: 'Summer holidays' }], nationwide: false, subdivisions: [{ code: 'DE-BY' }, { code: 'DE-BW' }] },
        { startDate: '2026-12-23', endDate: '2027-01-06', name: [{ language: 'DE', text: 'Weihnachtsferien' }], nationwide: true, subdivisions: [] },
    ];
    const { periods, seasonNames } = normalizeOpenSchoolHolidays(records, 'DE', { language: 'en' });
    assert.deepEqual(periods, [
        { season: 'sommerferien', zone: 'DE-BY', start: '2026-07-27', end: '2026-09-08' },
        { season: 'sommerferien', zone: 'DE-BW', start: '2026-07-27', end: '2026-09-08' },
        { season: 'weihnachtsferien', zone: 'DE', start: '2026-12-23', end: '2027-01-07' },
    ]);
    assert.deepEqual(seasonNames, { sommerferien: 'Summer holidays', weihnachtsferien: 'Weihnachtsferien' });
});

test('OpenHolidays : seules les fêtes nationales sont retenues', () => {
    const days = normalizeOpenPublicHolidays([
        { startDate: '2026-10-03', nationwide: true, name: [{ language: 'DE', text: 'Tag der Deutschen Einheit' }, { language: 'EN', text: 'German Unity Day' }] },
        { startDate: '2026-11-01', nationwide: false, name: [{ language: 'DE', text: 'Allerheiligen' }] },
    ], { language: 'en', countryLanguage: 'DE' });
    assert.deepEqual(days, { '2026-10-03': 'German Unity Day' });
});

test('buildCalendarContext réunit plusieurs pays', async () => {
    const ctx = await buildCalendarContext(2026, { countries: ['FR', 'DE'], language: 'fr' }, fakeFetch);
    assert.deepEqual(ctx.countries, ['FR', 'DE']);
    assert.ok(ctx.schoolPeriods.some((p) => p.zone === 'A' && p.season === 'hiver'));
    assert.ok(ctx.schoolPeriods.some((p) => p.zone === 'DE-BY' && p.season === 'sommerferien'));
    assert.equal(ctx.seasonNames.sommerferien, 'Vacances d\'été');
    assert.equal(ctx.publicHolidays['2026-07-14'], '14 juillet');
    assert.equal(ctx.publicHolidays['2026-10-03'], 'Jour de l\'unité allemande');
    for (let i = 1; i < ctx.schoolPeriods.length; i++) {
        assert.ok(ctx.schoolPeriods[i - 1].start <= ctx.schoolPeriods[i].start, 'périodes triées');
    }
});
