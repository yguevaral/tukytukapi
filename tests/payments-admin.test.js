const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const ioCalls = [];
const fakeIo = {
    to(room) { return { emit(event, payload) { ioCalls.push({ room, event, payload }); } }; }
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) {
        return { io: fakeIo };
    }
    return originalLoad(request, parent, isMain);
};

const {
    adminListPayments,
    adminApprovePayment,
    adminRejectPayment,
    adminCreatePayment
} = require('../controllers/payments');

test.after(() => { Module._load = originalLoad; });

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListPayments aplica filtros opcionales', async (t) => {
    const origAggregate = Payment.aggregate;
    t.after(() => { Payment.aggregate = origAggregate; });

    let captured;
    Payment.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ payments: [], meta: [] }];
    };

    const req = { query: { status: 'pendiente', driverUid: 'd1', page: '1', limit: '20' } };
    const res = makeRes();
    await adminListPayments(req, res);
    const firstMatch = captured.find(s => s.$match)?.$match;
    assert.equal(firstMatch.status, 'pendiente');
    assert.ok(firstMatch.driver);
});

test('adminApprovePayment 409 si pago no está pendiente', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });
    Payment.findById = async () => ({ status: 'aprobado', save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminApprovePayment 200 setea startsAt/expiresAt y emite socket', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Payment.findById = origFindById;
        Payment.findOne = origPaymentFindOne;
    });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) }); // no vigencia activa

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'aprobado');
    assert.equal(paymentDoc.reviewedBy, 'a1');
    assert.ok(paymentDoc.startsAt);
    assert.ok(paymentDoc.expiresAt);
    const diffDays = (paymentDoc.expiresAt - paymentDoc.startsAt) / (1000 * 60 * 60 * 24);
    assert.equal(Math.round(diffDays), 30);
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(driverId));
    assert.equal(ioCalls[0].event, 'payment-approved');
});

test('adminApprovePayment acumula días si hay vigencia activa', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Payment.findById = origFindById;
        Payment.findOne = origPaymentFindOne;
    });

    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(paymentDoc.startsAt.getTime(), future.getTime());
});

test('adminRejectPayment requiere adminComment', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });
    Payment.findById = async () => ({ status: 'pendiente', driver: 'd1', save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'p1' }, body: {} };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminRejectPayment 200 con adminComment y emite payment-rejected', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        status: 'pendiente',
        driver: driverId,
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'a1', params: { id: 'p1' }, body: { adminComment: 'foto borrosa' } };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'rechazado');
    assert.equal(paymentDoc.adminComment, 'foto borrosa');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].event, 'payment-rejected');
});

test('adminCreatePayment requiere adminComment', async (t) => {
    const req = { uid: 'a1', body: { driverUid: 'd1' }, file: null };
    const res = makeRes();
    await adminCreatePayment(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminCreatePayment 200 con adminComment crea Payment aprobado y emite socket', async (t) => {
    ioCalls.length = 0;
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    const origPaymentSave = Payment.prototype.save;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
        Payment.prototype.save = origPaymentSave;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Usuario.findById = () => ({ select: async () => ({ type: 'C' }) });
    Driver.findOne = async () => ({});
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    let saved;
    Payment.prototype.save = async function() { saved = this; this._id = new mongoose.Types.ObjectId(); return this; };

    const req = {
        uid: 'a1',
        body: { driverUid: 'd1', adminComment: 'pagó en efectivo' },
        file: null
    };
    const res = makeRes();
    await adminCreatePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.status, 'aprobado');
    assert.equal(saved.createdBy, 'admin');
    assert.equal(saved.adminComment, 'pagó en efectivo');
    assert.equal(saved.reviewedBy, 'a1');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].event, 'payment-approved');
});
