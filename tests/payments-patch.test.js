const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../models/payment');
const { adminPatchPayment } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminPatchPayment 404 si no existe', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => null;

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminPatchPayment 409 si status es aprobado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'aprobado', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminPatchPayment 409 si status es vencido', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'vencido', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
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

    const req = { uid: 'admin1', params: { id: 'x' }, body: { adminComment: 'nuevo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.adminComment, 'nuevo');
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comentario_editado');
    assert.equal(paymentDoc.events[0].by, 'admin1');
    assert.equal(paymentDoc.events[0].reason, 'nuevo');
});

test('adminPatchPayment 200 con file reemplaza receiptUrl y agrega evento comprobante_actualizado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'rechazado',
        receiptUrl: '/api/payments/receipt/viejo.jpg',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    // Stub fs.unlink para evitar tocar disco
    const fs = require('fs');
    const origUnlink = fs.unlink;
    let unlinked;
    fs.unlink = (p, cb) => { unlinked = p; cb && cb(null); };
    t.after(() => { fs.unlink = origUnlink; });

    const req = { uid: 'admin1', params: { id: 'x' }, body: {}, file: { filename: 'nuevo.jpg' } };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.receiptUrl, '/api/payments/receipt/nuevo.jpg');
    assert.match(unlinked || '', /viejo\.jpg$/);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comprobante_actualizado');
});
