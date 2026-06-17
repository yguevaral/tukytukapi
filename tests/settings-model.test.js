const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../models/settings');

test('Settings tiene defaults driverMonthlyPrice=200, durationDays=30, currency=GTQ', () => {
    const s = new Settings({});
    assert.equal(s.driverMonthlyPrice, 200);
    assert.equal(s.driverMonthlyDurationDays, 30);
    assert.equal(s.currency, 'GTQ');
});

test('Settings acepta override', () => {
    const s = new Settings({ driverMonthlyPrice: 150, driverMonthlyDurationDays: 60, currency: 'USD' });
    assert.equal(s.driverMonthlyPrice, 150);
    assert.equal(s.driverMonthlyDurationDays, 60);
    assert.equal(s.currency, 'USD');
});
