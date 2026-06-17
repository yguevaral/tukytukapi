const test = require('node:test');
const assert = require('node:assert/strict');
const Payment = require('../models/payment');

test('Payment acepta status pendiente por defecto', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg'
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
    assert.equal(p.status, 'pendiente');
});

test('Payment rechaza status fuera del enum', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        status: 'approved'
    });
    const err = p.validateSync();
    assert.ok(err);
    assert.match(err.errors.status.message, /approved/);
});

test('Payment rechaza createdBy fuera del enum', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'system'
    });
    const err = p.validateSync();
    assert.ok(err);
    assert.match(err.errors.createdBy.message, /system/);
});

test('Payment requiere amount, durationDays, driver y createdBy', () => {
    const p = new Payment({});
    const err = p.validateSync();
    assert.ok(err);
    assert.ok(err.errors.driver);
    assert.ok(err.errors.amount);
    assert.ok(err.errors.durationDays);
    assert.ok(err.errors.createdBy);
});

test('Payment toJSON expone uid y omite __v/_id/password', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 100, durationDays: 30,
        createdBy: 'admin', adminComment: 'pagó en efectivo'
    });
    const json = p.toJSON();
    assert.ok(json.uid);
    assert.equal(json._id, undefined);
    assert.equal(json.__v, undefined);
});
