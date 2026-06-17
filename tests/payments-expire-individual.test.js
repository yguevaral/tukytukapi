const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Usuario = require('../models/usuario');
const { adminExpirePayment } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

const VALID_ID = new mongoose.Types.ObjectId().toHexString();

test('adminExpirePayment 400 si id es inválido', async () => {
    const req = { uid: 'a1', params: { id: 'no-es-objectid' } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'id inválido');
});

test('adminExpirePayment 404 si no existe', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => null;

    const req = { uid: 'a1', params: { id: VALID_ID } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminExpirePayment 409 si status no es aprobado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'pendiente', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: VALID_ID } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminExpirePayment 200 marca vencido, evento con by=admin, desactiva conductor', async (t) => {
    const origFindById = Payment.findById;
    const origUpdateOne = Usuario.updateOne;
    t.after(() => { Payment.findById = origFindById; Usuario.updateOne = origUpdateOne; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        driver: driverId, status: 'aprobado', events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    let updateCall;
    Usuario.updateOne = async (filter, update) => { updateCall = { filter, update }; return { matchedCount: 1, modifiedCount: 1 }; };

    const req = { uid: 'admin1', params: { id: VALID_ID } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'vencido');
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'vencido');
    assert.equal(paymentDoc.events[0].by, 'admin1');
    assert.equal(String(updateCall.filter._id), String(driverId));
    assert.equal(updateCall.update.$set.online, false);
});
