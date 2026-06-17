const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { setDriverRejectTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('setDriverRejectTrip 409 si el viaje ya no está en S', async (t) => {
    const original = Trip.updateOne;
    t.after(() => { Trip.updateOne = original; });
    Trip.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

    const req = { uid: 'd1', body: { uid_trip: 't1' } };
    const res = makeRes();
    await setDriverRejectTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
});

test('setDriverRejectTrip 200 agrega el driver a rejectedBy con $addToSet', async (t) => {
    const original = Trip.updateOne;
    t.after(() => { Trip.updateOne = original; });

    let calledWithFilter;
    let calledWithUpdate;
    Trip.updateOne = async (filter, update) => {
        calledWithFilter = filter;
        calledWithUpdate = update;
        return { matchedCount: 1, modifiedCount: 1 };
    };

    const req = { uid: 'driver-uid-1', body: { uid_trip: 'trip-id-1' } };
    const res = makeRes();
    await setDriverRejectTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(calledWithFilter._id, 'trip-id-1');
    assert.equal(calledWithFilter.user_status, 'S');
    assert.deepEqual(calledWithUpdate, { $addToSet: { rejectedBy: 'driver-uid-1' } });
});
