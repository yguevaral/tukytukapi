const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { cancelUserTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

const stubMongo = (t) => {
    const originalFindOne = Trip.findOne;
    const originalSave = Trip.prototype.save;
    t.after(() => {
        Trip.findOne = originalFindOne;
        Trip.prototype.save = originalSave;
    });
};

test('cancelUserTrip 404 si el viaje no existe', async (t) => {
    stubMongo(t);
    Trip.findOne = async () => null;

    const req = { uid: 'uA', body: { uid_trip: 'tX' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
});

test('cancelUserTrip 403 si el viaje no pertenece al usuario', async (t) => {
    stubMongo(t);
    Trip.findOne = async () => ({
        usuario: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        user_status: 'S',
        save: async function() { return this; }
    });

    const req = { uid: '507f1f77bcf86cd799439099', body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
});

test('cancelUserTrip 409 si user_status no es S', async (t) => {
    stubMongo(t);
    const ownerId = new mongoose.Types.ObjectId();
    Trip.findOne = async () => ({
        usuario: ownerId,
        user_status: 'A',
        save: async function() { return this; }
    });

    const req = { uid: ownerId.toString(), body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.match(res.body.msg, /solo se puede cancelar/i);
});

test('cancelUserTrip 200 setea user_status=C y cancelledAt', async (t) => {
    stubMongo(t);
    const ownerId = new mongoose.Types.ObjectId();
    const saved = {
        usuario: ownerId,
        user_status: 'S',
        save: async function() { return this; }
    };
    Trip.findOne = async () => saved;

    const req = { uid: ownerId.toString(), body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.trip.user_status, 'C');
    assert.ok(res.body.trip.cancelledAt instanceof Date);
});
