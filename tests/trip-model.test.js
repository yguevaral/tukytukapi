const test = require('node:test');
const assert = require('node:assert/strict');

const Trip = require('../models/trip');

test('Trip schema acepta user_status C', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        user_status: 'C'
    });
    const err = trip.validateSync();
    assert.equal(err, undefined, 'no debería haber error de validación');
    assert.equal(trip.user_status, 'C');
});

test('Trip schema tiene rejectedBy vacío por defecto', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4'
    });
    assert.deepEqual(trip.rejectedBy.toObject(), []);
});

test('Trip schema acepta cancelledAt', () => {
    const now = new Date();
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        cancelledAt: now
    });
    assert.equal(trip.cancelledAt.getTime(), now.getTime());
});

test('Trip schema rechaza user_status fuera del enum', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        user_status: 'X'
    });
    const err = trip.validateSync();
    assert.ok(err, 'debería haber error de validación');
    assert.match(err.errors.user_status.message, /X/);
});
