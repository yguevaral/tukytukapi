const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const Payment = require('../models/payment');

const { setOnline } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('setOnline 200 si pasajero pone online=true', async (t) => {
    const origFindById = Usuario.findById;
    t.after(() => { Usuario.findById = origFindById; });

    Usuario.findById = async () => ({
        type: 'U', online: false,
        save: async function() { return this; }
    });

    const req = { uid: 'u1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
});

test('setOnline 402 si conductor sin pago intenta online=true', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Usuario.findById = async () => ({ type: 'C', online: false, save: async function() { return this; } });
    Driver.findOne = async () => ({});
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) }); // sin vigencia
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const req = { uid: 'd1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.msg, 'mensualidad_vencida');
    assert.deepEqual(res.body.price, { amount: 200, durationDays: 30, currency: 'GTQ' });
});

test('setOnline 200 si conductor al día pone online=true', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
    });

    const usuarioDoc = { type: 'C', online: false, save: async function() { return this; } };
    Usuario.findById = async () => usuarioDoc;
    Driver.findOne = async () => ({});
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const req = { uid: 'd1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.online, true);
});

test('setOnline 200 si conductor pone online=false sin gate', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    t.after(() => { Usuario.findById = origUsuarioFindById; });

    const usuarioDoc = { type: 'C', online: true, save: async function() { return this; } };
    Usuario.findById = async () => usuarioDoc;

    const req = { uid: 'd1', body: { online: false } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.online, false);
});
