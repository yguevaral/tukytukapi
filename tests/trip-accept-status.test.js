const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

// Spy mínimo del módulo index (donde vive io)
const ioCalls = [];
const fakeIo = {
    to(room) {
        return {
            emit(event, payload) {
                ioCalls.push({ room, event, payload });
            }
        };
    }
};

// Mockear el require de '../index' antes de cargar el controller
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) {
        return { io: fakeIo };
    }
    return originalLoad(request, parent, isMain);
};

const { setDriverAcceptTrip, setDriverStatusTrip } = require('../controllers/trip');

test.after(() => {
    Module._load = originalLoad;
});

test('setDriverAcceptTrip 409 si el driver está en rejectedBy', async (t) => {
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });
    Trip.findOne = async () => ({
        rejectedBy: [{ toString: () => 'driver-1' }],
        user_status: 'S',
        save: async function() { return this; }
    });

    const req = {
        uid: 'driver-1',
        body: { uid_trip: 't1', driver_start_lat: '14.6', driver_start_lng: '-90.5' }
    };
    const res = makeRes();
    await setDriverAcceptTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
});

test('setDriverAcceptTrip 200 emite trip-accepted al pasajero', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        usuario: passengerId,
        rejectedBy: [],
        user_status: 'S',
        driver_status: 'P',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = {
        uid: 'driver-1',
        body: { uid_trip: 't1', driver_start_lat: '14.6', driver_start_lng: '-90.5' }
    };
    const res = makeRes();
    await setDriverAcceptTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(tripDoc.user_status, 'A');
    assert.equal(tripDoc.driver_status, 'R');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(passengerId));
    assert.equal(ioCalls[0].event, 'trip-accepted');
    assert.ok(ioCalls[0].payload.trip);
});

test('setDriverStatusTrip emite trip-status-changed cuando driver_status es P', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        _id: 'trip-id-1',
        usuario: passengerId,
        user_status: 'A',
        driver_status: 'R',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = { uid: 'driver-1', body: { uid_trip: 'trip-id-1', driver_status: 'P' } };
    const res = makeRes();
    await setDriverStatusTrip(req, res);

    assert.equal(tripDoc.user_status, 'P');
    assert.equal(tripDoc.driver_status, 'P');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(passengerId));
    assert.equal(ioCalls[0].event, 'trip-status-changed');
    assert.equal(ioCalls[0].payload.driver_status, 'P');
});

test('setDriverStatusTrip emite trip-status-changed cuando driver_status es F', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        _id: 'trip-id-1',
        usuario: passengerId,
        user_status: 'P',
        driver_status: 'P',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = { uid: 'driver-1', body: { uid_trip: 'trip-id-1', driver_status: 'F' } };
    const res = makeRes();
    await setDriverStatusTrip(req, res);

    assert.equal(tripDoc.user_status, 'F');
    assert.equal(ioCalls[0].event, 'trip-status-changed');
    assert.equal(ioCalls[0].payload.driver_status, 'F');
});

test('setDriverStatusTrip NO emite trip-status-changed cuando driver_status es R', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        _id: 'trip-id-1',
        usuario: passengerId,
        user_status: 'A',
        driver_status: 'R',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = { uid: 'driver-1', body: { uid_trip: 'trip-id-1', driver_status: 'R' } };
    const res = makeRes();
    await setDriverStatusTrip(req, res);

    assert.equal(ioCalls.length, 0, 'no debería emitir cuando driver_status no es P ni F');
});
