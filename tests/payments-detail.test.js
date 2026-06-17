const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../models/payment');
const { adminGetPaymentDetail } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetPaymentDetail 404 si no existe', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });
    Payment.aggregate = async () => [];

    const validId = '507f1f77bcf86cd799439011';
    const req = { uid: 'a1', params: { id: validId } };
    const res = makeRes();
    await adminGetPaymentDetail(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetPaymentDetail 200 con shape esperado', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    const paymentId = '507f1f77bcf86cd799439012';
    Payment.aggregate = async () => [{
        _id: paymentId, amount: 200, durationDays: 30, status: 'pendiente',
        events: [{ type: 'creado', at: new Date(), by: 'admin' }],
        driverNombre: 'Juan', driverApellido: 'Pérez', driverPlate: 'P-1'
    }];

    const req = { uid: 'a1', params: { id: paymentId } };
    const res = makeRes();
    await adminGetPaymentDetail(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.payment.amount, 200);
    assert.equal(res.body.payment.uid, paymentId);
    assert.equal(res.body.driverNombre, 'Juan');
    assert.equal(res.body.driverPlate, 'P-1');
});
