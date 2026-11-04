import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchoolRecords, toParisDate, fetchSchoolHolidays, fetchPublicHolidays, seasonOf } from '../src/core/holidays.js';
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
