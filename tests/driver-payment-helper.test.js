const test = require('node:test');
const assert = require('node:assert/strict');

const Settings = require('../models/settings');
const Payment = require('../models/payment');
const { getSettings, getDriverPrice, isDriverPaid, getNextStartsAt, addDays } = require('../helpers/driverPayment');

const stubFindOne = (Model, t, returnValue) => {
    const original = Model.findOne;
    t.after(() => { Model.findOne = original; });
    Model.findOne = (...args) => {
        const chain = { sort: () => Promise.resolve(returnValue) };
        if (typeof returnValue === 'function') {
            return { sort: () => Promise.resolve(returnValue(...args)) };
        }
        return chain.sort();
    };
};

test('addDays suma días correctamente', () => {
    const d = new Date('2026-06-17T12:00:00Z');
    const d2 = addDays(d, 30);
    assert.equal(d2.toISOString(), '2026-07-17T12:00:00.000Z');
});

test('getSettings crea documento con defaults si no existe', async (t) => {
    const origFindOne = Settings.findOne;
    const origCreate = Settings.create;
    t.after(() => { Settings.findOne = origFindOne; Settings.create = origCreate; });

    Settings.findOne = async () => null;
    let createdWith;
    Settings.create = async (doc) => { createdWith = doc; return { driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' }; };

    const s = await getSettings();
    assert.deepEqual(createdWith, {});
    assert.equal(s.driverMonthlyPrice, 200);
});

test('getDriverPrice usa override si specialPrice está presente', async (t) => {
    const origFindOne = Settings.findOne;
    t.after(() => { Settings.findOne = origFindOne; });
    Settings.findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const price = await getDriverPrice({ specialPrice: 150, specialDurationDays: 60 });
    assert.equal(price.amount, 150);
    assert.equal(price.durationDays, 60);
    assert.equal(price.currency, 'GTQ');
});

test('getDriverPrice usa Settings si no hay override', async (t) => {
    const origFindOne = Settings.findOne;
    t.after(() => { Settings.findOne = origFindOne; });
    Settings.findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const price = await getDriverPrice({});
    assert.equal(price.amount, 200);
    assert.equal(price.durationDays, 30);
});

test('isDriverPaid true cuando hay pago aprobado vigente', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve({ uid: 'p1' }) });

    const paid = await isDriverPaid('d1');
    assert.equal(paid, true);
});

test('isDriverPaid false cuando no hay pago vigente', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const paid = await isDriverPaid('d1');
    assert.equal(paid, false);
});

test('getNextStartsAt devuelve expiresAt del último aprobado si está activo', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });

    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const next = await getNextStartsAt('d1');
    assert.equal(next.getTime(), future.getTime());
});

test('getNextStartsAt devuelve now si no hay vigencia activa', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const before = Date.now();
    const next = await getNextStartsAt('d1');
    assert.ok(next.getTime() >= before);
    assert.ok(next.getTime() <= before + 1000);
});
