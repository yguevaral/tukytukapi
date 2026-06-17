const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const { adminPatchPayment } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

const VALID_ID = new mongoose.Types.ObjectId().toHexString();

test('adminPatchPayment 400 si id es inválido', async () => {
    const req = { uid: 'a1', params: { id: 'no-es-objectid' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'id inválido');
});

test('adminPatchPayment 404 si no existe', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => null;

    const req = { uid: 'a1', params: { id: VALID_ID }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminPatchPayment 409 si status es aprobado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'aprobado', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: VALID_ID }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminPatchPayment 409 si status es vencido', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'vencido', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: VALID_ID }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminPatchPayment 200 actualiza adminComment y agrega evento comentario_editado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'pendiente',
        adminComment: 'viejo',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'admin1', params: { id: VALID_ID }, body: { adminComment: 'nuevo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.adminComment, 'nuevo');
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comentario_editado');
    assert.equal(paymentDoc.events[0].by, 'admin1');
    assert.equal(paymentDoc.events[0].reason, 'nuevo');
});

test('adminPatchPayment trim adminComment: espacios no generan cambio', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'pendiente',
        adminComment: 'igual',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    // Enviar con espacios alrededor pero mismo contenido -> sin cambios
    const req = { uid: 'admin1', params: { id: VALID_ID }, body: { adminComment: '  igual  ' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.msg, 'Sin cambios');
});

test('adminPatchPayment guarda adminComment trimado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'pendiente',
        adminComment: 'viejo',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'admin1', params: { id: VALID_ID }, body: { adminComment: '  nuevo con espacios  ' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.adminComment, 'nuevo con espacios');
});

test('adminPatchPayment 200 con file reemplaza receiptUrl, fs.unlink DESPUÉS del save', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    let saveCalledAt = null;
    let unlinkCalledAt = null;

    const paymentDoc = {
        status: 'rechazado',
        receiptUrl: '/api/payments/receipt/viejo.jpg',
        events: [],
        save: async function() {
            saveCalledAt = Date.now();
            return this;
        }
    };
    Payment.findById = async () => paymentDoc;

    // Stub fs.unlink para evitar tocar disco y capturar orden
    const fs = require('fs');
    const origUnlink = fs.unlink;
    let unlinked;
    fs.unlink = (p, cb) => {
        unlinkCalledAt = Date.now();
        unlinked = p;
        cb && cb(null);
    };
    t.after(() => { fs.unlink = origUnlink; });

    const req = { uid: 'admin1', params: { id: VALID_ID }, body: {}, file: { filename: 'nuevo.jpg' } };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.receiptUrl, '/api/payments/receipt/nuevo.jpg');
    assert.match(unlinked || '', /viejo\.jpg$/);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comprobante_actualizado');
    // Verificar que unlink ocurrió DESPUÉS del save
    assert.ok(saveCalledAt !== null, 'save debe haberse llamado');
    assert.ok(unlinkCalledAt !== null, 'unlink debe haberse llamado');
    assert.ok(unlinkCalledAt >= saveCalledAt, 'unlink debe ocurrir después del save');
});
