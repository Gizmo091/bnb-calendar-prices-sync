import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceInText, parsePrice } from '../src/adapters/common.js';

test('priceInText ignore le numéro du jour sur la ligne précédente', () => {
    assert.equal(priceInText('10\n160 €'), 160);
    assert.equal(priceInText('jeudi 12 nov.\n12\nPrix par nuit\n118 €'), 118);
    assert.equal(priceInText('4\n1 160 €\nAirbnb'), 1160);
    assert.equal(priceInText('12\n1 250,50 €'), 1250.5);
    assert.equal(priceInText('samedi 13 févr.\n13'), null);
});

test('parsePrice', () => {
    assert.equal(parsePrice('1 160'), 1160);
    assert.equal(parsePrice('199,00'), 199);
    assert.equal(parsePrice('abc'), null);
});
