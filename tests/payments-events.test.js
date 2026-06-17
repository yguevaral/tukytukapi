const test = require('node:test');
const assert = require('node:assert/strict');
const Payment = require('../models/payment');

test('Payment status acepta vencido', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        status: 'vencido'
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
});

test('Payment events está vacío por defecto', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg'
    });
    assert.deepEqual(p.events.toObject(), []);
});

test('Payment acepta events con type, at, by y reason', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        events: [{ type: 'aprobado', at: new Date(), by: 'admin1' }]
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
    assert.equal(p.events[0].type, 'aprobado');
});
