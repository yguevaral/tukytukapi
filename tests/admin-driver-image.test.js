const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Driver = require('../models/driver');
const Usuario = require('../models/usuario');
const { adminUploadDriverImage } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminUploadDriverImage 400 si tipo invalido', async () => {
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'mal' }, file: { filename: 'x.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminUploadDriverImage 400 si no hay archivo', async () => {
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: null };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminUploadDriverImage 404 si driver no existe', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    Driver.findOne = async () => null;

    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: { filename: 'x.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminUploadDriverImage 200 setea imageProfile cuando tipo=perfil', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });

    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: { filename: '123-abc.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(driverDoc.imageProfile, '/api/usuarios/admin/drivers/imagen/123-abc.jpg');
    assert.equal(driverDoc.imageDPI1, '');
});

test('adminUploadDriverImage borra archivo previo al reemplazar imagen', async (t) => {
    const fs = require('fs');
    const path = require('path');
    const orig = Driver.findOne;
    const origUnlink = fs.unlink;
    t.after(() => {
        Driver.findOne = orig;
        fs.unlink = origUnlink;
    });

    let deletedPath = null;
    fs.unlink = (p, cb) => { deletedPath = p; cb(null); };

    const driverDoc = {
        imageProfile: '/api/usuarios/admin/drivers/imagen/viejo.jpg',
        imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: { filename: 'nuevo.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(driverDoc.imageProfile, '/api/usuarios/admin/drivers/imagen/nuevo.jpg');
    // Verifica que se intentó borrar el archivo anterior
    assert.ok(deletedPath && deletedPath.endsWith(path.join('uploads/drivers', 'viejo.jpg')),
        `debería intentar borrar viejo.jpg, borró: ${deletedPath}`);
});

test('adminUploadDriverImage 200 setea imageDPI1 cuando tipo=dpi1', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'dpi1' }, file: { filename: 'd1.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(driverDoc.imageDPI1, '/api/usuarios/admin/drivers/imagen/d1.jpg');
});

test('adminUploadDriverImage 200 setea imageDPI2 cuando tipo=dpi2', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'dpi2' }, file: { filename: 'd2.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(driverDoc.imageDPI2, '/api/usuarios/admin/drivers/imagen/d2.jpg');
});

const { serveDriverImage } = require('../controllers/usuarios');

const makeFileRes = () => ({
    statusCode: 200, body: null, sentFile: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    sendFile(p) { this.sentFile = p; return this; }
});

test('serveDriverImage 400 si filename inválido', async () => {
    const req = { uid: 'u1', params: { filename: '../etc/passwd' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('serveDriverImage 404 si no encuentra driver con esa URL', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    Driver.findOne = async () => null;

    const req = { uid: 'u1', params: { filename: 'noexiste.jpg' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 404);
});

test('serveDriverImage 403 si no es dueño ni admin', async (t) => {
    const origD = Driver.findOne;
    const origU = Usuario.findById;
    t.after(() => { Driver.findOne = origD; Usuario.findById = origU; });

    Driver.findOne = async () => ({ usuario: 'owner-uid' });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'otro-uid', params: { filename: 'x.jpg' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 403);
});
