const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const { adminListPayments } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListPayments usa aggregate con $lookup a usuarios y drivers', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    let captured;
    Payment.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ payments: [], meta: [] }];
    };

    const req = { uid: 'admin1', query: {} };
    const res = makeRes();
    await adminListPayments(req, res);
    const lookupUsuario = captured.find(s => s.$lookup && s.$lookup.from === 'usuarios');
    const lookupDriver = captured.find(s => s.$lookup && s.$lookup.from === 'drivers');
    assert.ok(lookupUsuario);
    assert.ok(lookupDriver);
});

test('adminListPayments mapea el resultado con driverNombre y driverPlate', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    Payment.aggregate = async () => [{
        payments: [{
            _id: 'p1', amount: 200, durationDays: 30, status: 'pendiente',
            driverNombre: 'Juan', driverApellido: 'Pérez', driverPlate: 'P-1'
        }],
        meta: [{ total: 1 }]
    }];

    const req = { uid: 'admin1', query: {} };
    const res = makeRes();
    await adminListPayments(req, res);
    assert.equal(res.body.payments.length, 1);
    assert.equal(res.body.payments[0].driverNombre, 'Juan');
    assert.equal(res.body.payments[0].driverApellido, 'Pérez');
    assert.equal(res.body.payments[0].driverPlate, 'P-1');
    assert.equal(res.body.total, 1);
});

test('adminListPayments aplica filtros status y driverUid', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    let captured;
    Payment.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ payments: [], meta: [] }];
    };

    const req = { uid: 'admin1', query: { status: 'aprobado', driverUid: '507f1f77bcf86cd799439011' } };
    const res = makeRes();
    await adminListPayments(req, res);
    const matches = captured.filter(s => s.$match);
    // primer $match aplica los filtros del query
    const first = matches[0].$match;
    assert.equal(first.status, 'aprobado');
    assert.ok(first.driver);
});

test('adminListPayments capa limit a 100', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });
    Payment.aggregate = async () => [{ payments: [], meta: [] }];

    const req = { uid: 'admin1', query: { limit: '500' } };
    const res = makeRes();
    await adminListPayments(req, res);
    assert.equal(res.body.limit, 100);
});
