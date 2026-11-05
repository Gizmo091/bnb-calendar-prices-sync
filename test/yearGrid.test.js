import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLevels, describeDate } from '../src/ui/yearGrid.js';

test('priceLevels classe les prix par rang, du plus bas au plus haut', () => {
    const { levels, min, max } = priceLevels({
        '2027-01-01': { price: 118 },
        '2027-01-02': { price: 398 },
        '2027-01-03': { price: 220 },
        '2027-01-04': { price: 118 },
        '2027-01-05': {},
    });
    assert.equal(min, 118);
    assert.equal(max, 398);
    assert.equal(levels['2027-01-01'], 0);
    assert.equal(levels['2027-01-04'], 0);
    assert.equal(levels['2027-01-03'], 0.5);
    assert.equal(levels['2027-01-02'], 1);
    assert.equal('2027-01-05' in levels, false);
});

test('priceLevels avec un seul prix met tout au niveau le plus bas', () => {
    const { levels, min, max } = priceLevels({ '2027-01-01': { price: 160 }, '2027-01-02': { price: 160 } });
    assert.equal(min, 160);
    assert.equal(max, 160);
    assert.deepEqual(Object.values(levels), [0, 0]);
});

test('describeDate écrit la date en français court', () => {
    assert.match(describeDate('2027-02-06'), /^sam\.? 6 févr\.? 2027$/);
});
