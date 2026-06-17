const test = require('node:test');
const assert = require('node:assert/strict');

const Settings = require('../models/settings');
const Driver = require('../models/driver');

const { adminGetSettings, adminUpdateSettings } = require('../controllers/payments');
const { adminSetSpecialPricing } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetSettings crea defaults si no existe', async (t) => {
    const origFindOne = Settings.findOne;
    const origCreate = Settings.create;
    t.after(() => { Settings.findOne = origFindOne; Settings.create = origCreate; });
    Settings.findOne = async () => null;
    let createdWith;
    Settings.create = async (d) => { createdWith = d; return { driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' }; };

    const req = { uid: 'a1' };
    const res = makeRes();
    await adminGetSettings(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.driverMonthlyPrice, 200);
    assert.deepEqual(createdWith, {});
});

test('adminUpdateSettings hace upsert', async (t) => {
    const origFindOneAndUpdate = Settings.findOneAndUpdate;
    t.after(() => { Settings.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Settings.findOneAndUpdate = async (filter, update, opts) => {
        captured = { filter, update, opts };
        return { driverMonthlyPrice: 250, driverMonthlyDurationDays: 30, currency: 'GTQ' };
    };

    const req = { uid: 'a1', body: { driverMonthlyPrice: 250 } };
    const res = makeRes();
    await adminUpdateSettings(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(captured.opts.upsert, true);
    assert.deepEqual(captured.update.$set, { driverMonthlyPrice: 250 });
});

test('adminSetSpecialPricing actualiza al Driver', async (t) => {
    const origFindOneAndUpdate = Driver.findOneAndUpdate;
    t.after(() => { Driver.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Driver.findOneAndUpdate = async (filter, update, opts) => {
        captured = { filter, update, opts };
        return { specialPrice: 150, specialDurationDays: 60 };
    };

    const req = { uid: 'a1', params: { driverUid: 'd1' }, body: { specialPrice: 150, specialDurationDays: 60 } };
    const res = makeRes();
    await adminSetSpecialPricing(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.filter, { usuario: 'd1' });
    assert.equal(captured.update.$set.specialPrice, 150);
    assert.equal(captured.update.$set.specialDurationDays, 60);
});

test('adminSetSpecialPricing acepta null para borrar override', async (t) => {
    const origFindOneAndUpdate = Driver.findOneAndUpdate;
    t.after(() => { Driver.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Driver.findOneAndUpdate = async (filter, update, opts) => {
        captured = update;
        return {};
    };

    const req = { uid: 'a1', params: { driverUid: 'd1' }, body: { specialPrice: null, specialDurationDays: null } };
    const res = makeRes();
    await adminSetSpecialPricing(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(captured.$unset);
    assert.deepEqual(Object.keys(captured.$unset).sort(), ['specialDurationDays', 'specialPrice']);
});
