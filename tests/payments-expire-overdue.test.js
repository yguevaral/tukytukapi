const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Usuario = require('../models/usuario');
const { adminExpireOverdue } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminExpireOverdue caso sin pagos vencidos devuelve 0/0', async (t) => {
    const orig = Payment.find;
    t.after(() => { Payment.find = orig; });
    Payment.find = async () => [];

    const req = { uid: 'admin1' };
    const res = makeRes();
    await adminExpireOverdue(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.expiredCount, 0);
    assert.equal(res.body.deactivatedDrivers, 0);
});

test('adminExpireOverdue marca pagos como vencidos con by=system y desactiva conductores únicos', async (t) => {
    const origFind = Payment.find;
    const origUpdateOne = Usuario.updateOne;
    t.after(() => { Payment.find = origFind; Usuario.updateOne = origUpdateOne; });

    const driver1 = new mongoose.Types.ObjectId();
    const driver2 = new mongoose.Types.ObjectId();
    const p1 = { driver: driver1, status: 'aprobado', events: [], save: async function() { return this; } };
    const p2 = { driver: driver1, status: 'aprobado', events: [], save: async function() { return this; } }; // mismo driver
    const p3 = { driver: driver2, status: 'aprobado', events: [], save: async function() { return this; } };
    Payment.find = async () => [p1, p2, p3];

    let updateCalls = 0;
    Usuario.updateOne = async () => { updateCalls++; return { matchedCount: 1, modifiedCount: 1 }; };

    const req = { uid: 'admin1' };
    const res = makeRes();
    await adminExpireOverdue(req, res);
    assert.equal(res.body.expiredCount, 3);
    assert.equal(res.body.deactivatedDrivers, 2);  // únicos
    assert.equal(updateCalls, 2);
    assert.equal(p1.status, 'vencido');
    assert.equal(p1.events[0].type, 'vencido');
    assert.equal(p1.events[0].by, 'system');
});
