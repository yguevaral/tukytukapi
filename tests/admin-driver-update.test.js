const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { adminUpdateDriver } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminUpdateDriver 404 si usuario no existe', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => null;

    const req = { uid: 'a1', params: { uid: 'x' }, body: {} };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminUpdateDriver 409 si nuevo email choca', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    const origDriverFindOne = Driver.findOne;
    t.after(() => {
        Usuario.findById = origFindById;
        Usuario.findOne = origFindOne;
        Driver.findOne = origDriverFindOne;
    });

    const targetId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    Usuario.findById = async () => ({
        _id: targetId, type: 'C', email: 'old@x.com',
        save: async function() { return this; }
    });
    Usuario.findOne = async () => ({ _id: otherId, email: 'nuevo@x.com' });
    Driver.findOne = async () => ({ usuario: targetId, plate: 'P-1', save: async function() { return this; } });

    const req = { uid: 'a1', params: { uid: String(targetId) }, body: { email: 'nuevo@x.com' } };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.msg, 'email_duplicado');
});

test('adminUpdateDriver 200 actualiza solo campos enviados', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    const origDriverFindOne = Driver.findOne;
    t.after(() => {
        Usuario.findById = origFindById;
        Usuario.findOne = origFindOne;
        Driver.findOne = origDriverFindOne;
    });

    const usuarioDoc = {
        _id: new mongoose.Types.ObjectId(),
        type: 'C', email: 'old@x.com', nombre: 'Juan', telefono: '',
        save: async function() { return this; }
    };
    Usuario.findById = async () => usuarioDoc;
    Usuario.findOne = async () => null;
    const driverDoc = {
        plate: 'P-1', status: 'P', address: 'X',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = {
        uid: 'a1',
        params: { uid: String(usuarioDoc._id) },
        body: { telefono: '555-1234', status: 'A' }
    };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.telefono, '555-1234');
    assert.equal(usuarioDoc.nombre, 'Juan'); // sin cambio
    assert.equal(driverDoc.status, 'A');
    assert.equal(driverDoc.plate, 'P-1'); // sin cambio
    assert(res.body.driver); // driver debe estar en la respuesta
});

test('adminUpdateDriver devuelve driver en respuesta sin campos de conductor', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    const origDriverFindOne = Driver.findOne;
    t.after(() => {
        Usuario.findById = origFindById;
        Usuario.findOne = origFindOne;
        Driver.findOne = origDriverFindOne;
    });

    const usuarioDoc = {
        _id: new mongoose.Types.ObjectId(),
        type: 'C', email: 'old@x.com', nombre: 'Juan',
        save: async function() { return this; }
    };
    Usuario.findById = async () => usuarioDoc;
    Usuario.findOne = async () => null;
    const driverDoc = {
        _id: new mongoose.Types.ObjectId(),
        plate: 'P-1', status: 'A', address: 'Calle X',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = {
        uid: 'a1',
        params: { uid: String(usuarioDoc._id) },
        body: { nombre: 'Juanito' } // solo campo de usuario, sin campos de conductor
    };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.nombre, 'Juanito');
    assert(res.body.driver); // driver debe estar en la respuesta incluso sin actualizar
    assert.equal(res.body.driver._id, driverDoc._id);
});

test('adminUpdateDriver permite cambiar email a mismo usuario sin 409', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    const origDriverFindOne = Driver.findOne;
    t.after(() => {
        Usuario.findById = origFindById;
        Usuario.findOne = origFindOne;
        Driver.findOne = origDriverFindOne;
    });

    const targetId = new mongoose.Types.ObjectId();
    const usuarioDoc = {
        _id: targetId, type: 'C', email: 'old@x.com',
        save: async function() { return this; }
    };
    Usuario.findById = async () => usuarioDoc;
    // findOne devuelve el mismo usuario (caso de no cambiar pero pasar el mismo email)
    Usuario.findOne = async () => ({ _id: targetId, email: 'old@x.com' });
    Driver.findOne = async () => ({ usuario: targetId, plate: 'P-1', save: async function() { return this; } });

    const req = { uid: 'a1', params: { uid: String(targetId) }, body: { email: 'old@x.com' } };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 200);
});
