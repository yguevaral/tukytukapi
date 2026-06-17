const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const { validarConductor } = require('../middlewares/validar-conductor');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('validarConductor 401 si no hay uid', async () => {
    const req = {};
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(next, false);
});

test('validarConductor 401 si usuario no existe', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => null });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(next, false);
});

test('validarConductor 403 si type no es C', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(next, false);
});

test('validarConductor llama next si type es C', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => ({ type: 'C' }) });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(next, true);
});
