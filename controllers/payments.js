const { response } = require('express');
const path = require('path');
const fs = require('fs');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');
const { getDriverPrice } = require('../helpers/driverPayment');

// POST /api/payments/driver/upload
const uploadDriverPayment = async (req, res = response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, msg: 'Falta el comprobante' });
        }

        const driver = await Driver.findOne({ usuario: req.uid });
        const { amount, durationDays } = await getDriverPrice(driver || {});

        const payment = new Payment({
            driver: req.uid,
            amount,
            durationDays,
            status: 'pendiente',
            createdBy: 'driver',
            receiptUrl: `/api/payments/receipt/${req.file.filename}`
        });
        await payment.save();

        return res.status(200).json({ ok: true, msg: 'Comprobante recibido', payment });
    } catch (err) {
        console.error('uploadDriverPayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/driver/list
const listDriverPayments = async (req, res = response) => {
    try {
        const payments = await Payment.find({ driver: req.uid }).sort({ createdAt: -1 });
        return res.status(200).json({ ok: true, payments });
    } catch (err) {
        console.error('listDriverPayments', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/driver/status
const getDriverStatus = async (req, res = response) => {
    try {
        const driver = await Driver.findOne({ usuario: req.uid });
        const price = await getDriverPrice(driver || {});

        const now = new Date();
        const activePayment = await Payment.findOne({
            driver: req.uid,
            status: 'aprobado',
            expiresAt: { $gt: now }
        }).sort({ expiresAt: -1 });

        return res.status(200).json({
            ok: true,
            paid: !!activePayment,
            activePayment,
            price
        });
    } catch (err) {
        console.error('getDriverStatus', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/receipt/:filename
const serveReceipt = async (req, res = response) => {
    try {
        const { filename } = req.params;

        const payment = await Payment.findOne({
            receiptUrl: `/api/payments/receipt/${filename}`
        });

        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Comprobante no encontrado' });
        }

        const isOwner = String(payment.driver) === String(req.uid);
        if (!isOwner) {
            const usuario = await Usuario.findById(req.uid).select('type');
            if (!usuario || usuario.type !== 'A') {
                return res.status(403).json({ ok: false, msg: 'No autorizado' });
            }
        }

        const filePath = path.resolve(__dirname, '..', 'uploads', 'payments', filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
        }

        return res.sendFile(filePath);
    } catch (err) {
        console.error('serveReceipt', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

module.exports = {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt
};
