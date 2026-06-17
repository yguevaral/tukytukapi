const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt
} = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    sentFile: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    sendFile(p) { this.sentFile = p; return this; },
    setHeader(k, v) { this.headers[k] = v; }
});

test('uploadDriverPayment 400 si no hay archivo', async () => {
    const req = { uid: 'd1', file: null };
    const res = makeRes();
    await uploadDriverPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
});

test('uploadDriverPayment 200 crea Payment pendiente con receiptUrl', async (t) => {
    const origDriverFindOne = Driver.findOne;
    const origPaymentSave = Payment.prototype.save;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Driver.findOne = origDriverFindOne;
        Payment.prototype.save = origPaymentSave;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Driver.findOne = async () => ({ specialPrice: null, specialDurationDays: null });
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    let saved;
    Payment.prototype.save = async function() { saved = this; this._id = new mongoose.Types.ObjectId(); return this; };

    const req = { uid: 'd1', file: { filename: '1234-abc.jpg' } };
    const res = makeRes();
    await uploadDriverPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(saved.status, 'pendiente');
    assert.equal(saved.createdBy, 'driver');
    assert.equal(saved.amount, 200);
    assert.equal(saved.durationDays, 30);
    assert.equal(saved.receiptUrl, '/api/payments/receipt/1234-abc.jpg');
});

test('listDriverPayments devuelve pagos ordenados desc', async (t) => {
    const origFind = Payment.find;
    t.after(() => { Payment.find = origFind; });
    let capturedFilter;
    Payment.find = (filter) => {
        capturedFilter = filter;
        return { sort: () => Promise.resolve([{ uid: 'p1' }, { uid: 'p2' }]) };
    };

    const req = { uid: 'd1' };
    const res = makeRes();
    await listDriverPayments(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payments.length, 2);
    assert.equal(capturedFilter.driver, 'd1');
});

test('getDriverStatus paid=true cuando hay pago aprobado vigente', async (t) => {
    const origPaymentFindOne = Payment.findOne;
    const origDriverFindOne = Driver.findOne;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Payment.findOne = origPaymentFindOne;
        Driver.findOne = origDriverFindOne;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ uid: 'p1', expiresAt: future }) });
    Driver.findOne = async () => ({});
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const req = { uid: 'd1' };
    const res = makeRes();
    await getDriverStatus(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paid, true);
    assert.deepEqual(res.body.price, { amount: 200, durationDays: 30, currency: 'GTQ' });
});

test('serveReceipt 404 si el payment no existe', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = async () => null;

    const req = { uid: 'd1', params: { filename: 'no-existe.jpg' } };
    const res = makeRes();
    await serveReceipt(req, res);
    assert.equal(res.statusCode, 404);
});

test('serveReceipt 403 si el solicitante no es dueño ni admin', async (t) => {
    const origPaymentFindOne = Payment.findOne;
    const origUsuarioFindById = Usuario.findById;
    t.after(() => {
        Payment.findOne = origPaymentFindOne;
        Usuario.findById = origUsuarioFindById;
    });
    Payment.findOne = async () => ({ driver: 'd1', receiptUrl: '/api/payments/receipt/x.jpg' });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'otro', params: { filename: 'x.jpg' } };
    const res = makeRes();
    await serveReceipt(req, res);
    assert.equal(res.statusCode, 403);
});
