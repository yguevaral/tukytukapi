const test = require('node:test');
const assert = require('node:assert/strict');

const { validarAdmin } = require('../middlewares/validar-admin');

const makeRes = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
    };
    return res;
};

test('validarAdmin sin uid devuelve 401', async () => {
    const req = {};
    const res = makeRes();
    let nextCalled = false;
    await validarAdmin(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
    assert.match(res.body.msg, /No autenticado/);
});
