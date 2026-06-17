const test = require('node:test');
const assert = require('node:assert/strict');
const Payment = require('../models/payment');

test('Payment status acepta vencido', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        status: 'vencido'
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
});

test('Payment events está vacío por defecto', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg'
    });
    assert.deepEqual(p.events.toObject(), []);
});

test('Payment acepta events con type, at, by y reason', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        events: [{ type: 'aprobado', at: new Date(), by: 'admin1' }]
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
    assert.equal(p.events[0].type, 'aprobado');
});

// Tests de appendEvent en handlers existentes usando mock de io
const mongoose = require('mongoose');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const Module = require('module');
const originalLoad = Module._load;
const ioCalls = [];
const fakeIo = { to(room) { return { emit(event, payload) { ioCalls.push({ room, event, payload }); } }; } };
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) return { io: fakeIo };
    return originalLoad(request, parent, isMain);
};

const { adminApprovePayment, adminRejectPayment } = require('../controllers/payments');

test.after(() => { Module._load = originalLoad; });

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminApprovePayment agrega evento aprobado al events', async (t) => {
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => { Payment.findById = origFindById; Payment.findOne = origPaymentFindOne; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const req = { uid: 'admin-uid', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'aprobado');
    assert.equal(paymentDoc.events[0].by, 'admin-uid');
});

test('adminRejectPayment agrega evento rechazado con reason', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });

    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: new mongoose.Types.ObjectId(),
        status: 'pendiente',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'admin-uid', params: { id: 'p1' }, body: { adminComment: 'foto borrosa' } };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'rechazado');
    assert.equal(paymentDoc.events[0].by, 'admin-uid');
    assert.equal(paymentDoc.events[0].reason, 'foto borrosa');
});
