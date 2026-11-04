import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, eachDay, weekday, isISODate, yearBounds } from '../src/core/dates.js';

test('addDays franchit les mois et les années', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('addMonths', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-03-03');
    assert.equal(addMonths('2026-05-04', 18), '2027-11-04');
});

test('eachDay inclut les deux bornes', () => {
    assert.deepEqual([...eachDay('2026-02-27', '2026-03-01')], ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('weekday : 2026-11-07 est un samedi', () => {
    assert.equal(weekday('2026-11-07'), 6);
});

test('isISODate rejette les dates impossibles', () => {
    assert.ok(isISODate('2026-02-28'));
    assert.ok(!isISODate('2026-02-30'));
    assert.ok(!isISODate('2026-2-3'));
});

test('yearBounds', () => {
    assert.deepEqual(yearBounds(2027), { from: '2027-01-01', to: '2027-12-31' });
});
