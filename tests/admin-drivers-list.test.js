const test = require('node:test');
const assert = require('node:assert/strict');

const Driver = require('../models/driver');
const { adminListDrivers } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListDrivers sin filtros usa defaults (page=1, limit=20)', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: {} };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 20);
    assert.equal(res.body.total, 0);
});

test('adminListDrivers filtra por status', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: { status: 'A' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    // Encuentra el stage de $match con status
    const statusMatch = captured.find(s => s.$match && s.$match.status === 'A');
    assert.ok(statusMatch, 'debería incluir $match por status');
});

test('adminListDrivers filtra por search con regex en multiples campos', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: { search: 'juan' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    const searchMatch = captured.find(s => s.$match && s.$match.$or);
    assert.ok(searchMatch);
    const fields = searchMatch.$match.$or.map(c => Object.keys(c)[0]);
    assert.ok(fields.includes('usuario.nombre'));
    assert.ok(fields.includes('usuario.apellido'));
    assert.ok(fields.includes('usuario.email'));
    assert.ok(fields.includes('plate'));
});

test('adminListDrivers limita limit a 100 maximo', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    Driver.aggregate = async () => [{ drivers: [], meta: [] }];

    const req = { uid: 'a1', query: { limit: '500' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.body.limit, 100);
});

test('adminListDrivers transforma el shape a {driver, usuario}', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    Driver.aggregate = async () => [{
        drivers: [{
            _id: 'd1', plate: 'P-1', status: 'A',
            usuario: { _id: 'u1', nombre: 'Juan', email: 'j@x.com' }
        }],
        meta: [{ total: 1 }]
    }];

    const req = { uid: 'a1', query: {} };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.body.drivers.length, 1);
    assert.equal(res.body.drivers[0].driver.plate, 'P-1');
    assert.equal(res.body.drivers[0].usuario.nombre, 'Juan');
    assert.equal(res.body.total, 1);
});
