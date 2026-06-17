const test = require('node:test');
const assert = require('node:assert/strict');

const { getDriverListTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('getDriverListTrip excluye viajes con el driver en rejectedBy', async (t) => {
    const originalFind = Trip.find;
    t.after(() => { Trip.find = originalFind; });

    let capturedQuery;
    Trip.find = (q) => {
        capturedQuery = q;
        return {
            sort() { return this; },
            limit() { return Promise.resolve([]); }
        };
    };

    const req = { uid: 'driver-1' };
    const res = makeRes();
    await getDriverListTrip(req, res);

    assert.equal(capturedQuery.user_status, 'S');
    assert.deepEqual(capturedQuery.usuario, { $ne: 'driver-1' });
    assert.deepEqual(capturedQuery.rejectedBy, { $ne: 'driver-1' });
});
