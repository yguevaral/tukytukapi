const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { adminGetDriver } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetDriver 404 si usuario no existe', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => null;

    const req = { uid: 'a1', params: { uid: 'x' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetDriver 404 si type no es C', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => ({ type: 'U' });

    const req = { uid: 'a1', params: { uid: 'x' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetDriver 200 con usuario y driver', async (t) => {
    const origU = Usuario.findById;
    const origD = Driver.findOne;
    t.after(() => { Usuario.findById = origU; Driver.findOne = origD; });

    Usuario.findById = async () => ({ type: 'C', nombre: 'Juan' });
    Driver.findOne = async () => ({ plate: 'P-1', status: 'A' });

    const req = { uid: 'a1', params: { uid: 'u1' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.usuario.nombre, 'Juan');
    assert.equal(res.body.driver.plate, 'P-1');
});

test('adminGetDriver devuelve driver=null si no existe Driver row', async (t) => {
    const origU = Usuario.findById;
    const origD = Driver.findOne;
    t.after(() => { Usuario.findById = origU; Driver.findOne = origD; });

    Usuario.findById = async () => ({ type: 'C', nombre: 'Pedro' });
    Driver.findOne = async () => null;

    const req = { uid: 'a1', params: { uid: 'u1' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.driver, null);
});
