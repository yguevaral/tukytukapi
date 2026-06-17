const { response } = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');
const { getDriverPrice, getNextStartsAt, addDays, getSettings } = require('../helpers/driverPayment');
const Settings = require('../models/settings');

// Helper: agrega un evento al array events del documento (sin guardarlo)
function appendEvent(payment, type, by, reason) {
    if (!Array.isArray(payment.events)) payment.events = [];
    const event = { type, at: new Date() };
    if (by != null) event.by = String(by);
    if (reason != null) event.reason = String(reason);
    payment.events.push(event);
}

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
        appendEvent(payment, 'creado', req.uid);
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

        // Defensa contra path traversal: solo caracteres seguros en el nombre de archivo
        if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
            return res.status(400).json({ ok: false, msg: 'Nombre de archivo inválido' });
        }

        const uploadsPaymentsDir = path.resolve(__dirname, '..', 'uploads', 'payments');

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
        // Defensa en profundidad: verificar que la ruta resuelta esté dentro del directorio permitido
        if (!filePath.startsWith(uploadsPaymentsDir + path.sep) && filePath !== uploadsPaymentsDir) {
            return res.status(400).json({ ok: false, msg: 'Nombre de archivo inválido' });
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
        }

        return res.sendFile(filePath);
    } catch (err) {
        console.error('serveReceipt', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/admin/:id
const adminGetPaymentDetail = async (req, res = response) => {
    try {
        const { id } = req.params;
        let oid;
        try { oid = new mongoose.Types.ObjectId(id); }
        catch { return res.status(400).json({ ok: false, msg: 'id inválido' }); }

        const pipeline = [
            { $match: { _id: oid } },
            { $lookup: { from: 'usuarios', localField: 'driver', foreignField: '_id', as: '_usuario' } },
            { $unwind: { path: '$_usuario', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'drivers', localField: 'driver', foreignField: 'usuario', as: '_driver' } },
            { $unwind: { path: '$_driver', preserveNullAndEmptyArrays: true } },
            { $addFields: {
                driverNombre: '$_usuario.nombre',
                driverApellido: '$_usuario.apellido',
                driverPlate: '$_driver.plate'
            }},
            { $project: { _usuario: 0, _driver: 0 } }
        ];

        const result = await Payment.aggregate(pipeline);
        if (!result.length) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        const row = result[0];
        const { driverNombre, driverApellido, driverPlate, ...payment } = row;
        payment.uid = payment._id;
        return res.status(200).json({
            ok: true, payment, driverNombre, driverApellido, driverPlate
        });
    } catch (err) {
        console.error('adminGetPaymentDetail', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/admin/list
const adminListPayments = async (req, res = response) => {
    try {
        const { status, driverUid } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

        const firstMatch = {};
        if (status) firstMatch.status = status;
        if (driverUid) {
            try { firstMatch.driver = new mongoose.Types.ObjectId(driverUid); }
            catch { firstMatch.driver = driverUid; }
        }

        const pipeline = [
            { $match: firstMatch },
            { $lookup: { from: 'usuarios', localField: 'driver', foreignField: '_id', as: '_usuario' } },
            { $unwind: { path: '$_usuario', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'drivers', localField: 'driver', foreignField: 'usuario', as: '_driver' } },
            { $unwind: { path: '$_driver', preserveNullAndEmptyArrays: true } },
            { $addFields: {
                driverNombre: '$_usuario.nombre',
                driverApellido: '$_usuario.apellido',
                driverPlate: '$_driver.plate'
            }},
            { $project: { _usuario: 0, _driver: 0 } },
            {
                $facet: {
                    payments: [
                        { $sort: { createdAt: -1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit }
                    ],
                    meta: [{ $count: 'total' }]
                }
            }
        ];

        const result = await Payment.aggregate(pipeline);
        const payments = (result[0]?.payments ?? []).map((p) => ({ ...p, uid: p._id }));
        const total = result[0]?.meta?.[0]?.total ?? 0;
        return res.status(200).json({ ok: true, payments, total, page, limit });
    } catch (err) {
        console.error('adminListPayments', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// PUT /api/payments/admin/:id/approve
const adminApprovePayment = async (req, res = response) => {
    try {
        const { io } = require('../index');
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status !== 'pendiente') {
            return res.status(409).json({ ok: false, msg: 'Pago ya no está pendiente' });
        }
        payment.startsAt = await getNextStartsAt(payment.driver);
        payment.expiresAt = addDays(payment.startsAt, payment.durationDays);
        payment.status = 'aprobado';
        payment.reviewedBy = req.uid;
        payment.reviewedAt = new Date();
        appendEvent(payment, 'aprobado', req.uid);
        await payment.save();

        io.to(String(payment.driver)).emit('payment-approved', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminApprovePayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// PUT /api/payments/admin/:id/reject
const adminRejectPayment = async (req, res = response) => {
    try {
        const { adminComment } = req.body || {};
        if (!adminComment || String(adminComment).trim().length < 3) {
            return res.status(400).json({ ok: false, msg: 'adminComment es obligatorio (mínimo 3 caracteres)' });
        }
        const { io } = require('../index');
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status !== 'pendiente') {
            return res.status(409).json({ ok: false, msg: 'Pago ya no está pendiente' });
        }
        payment.status = 'rechazado';
        payment.adminComment = adminComment;
        payment.reviewedBy = req.uid;
        payment.reviewedAt = new Date();
        appendEvent(payment, 'rechazado', req.uid, payment.adminComment);
        await payment.save();

        io.to(String(payment.driver)).emit('payment-rejected', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminRejectPayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// POST /api/payments/admin/create
const adminCreatePayment = async (req, res = response) => {
    try {
        const { driverUid, adminComment, amount, durationDays } = req.body || {};
        if (!driverUid) {
            return res.status(400).json({ ok: false, msg: 'driverUid es obligatorio' });
        }
        if (!adminComment || String(adminComment).trim().length < 3) {
            return res.status(400).json({ ok: false, msg: 'adminComment es obligatorio (mínimo 3 caracteres)' });
        }
        const usuario = await Usuario.findById(driverUid).select('type');
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        const { io } = require('../index');
        const driver = await Driver.findOne({ usuario: driverUid });
        if (!driver) {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado o no completó registro' });
        }
        const price = await getDriverPrice(driver);
        const finalAmount = amount != null ? Number(amount) : price.amount;
        const finalDuration = durationDays != null ? Number(durationDays) : price.durationDays;

        if (!Number.isFinite(finalAmount) || finalAmount < 0) {
            return res.status(400).json({ ok: false, msg: 'amount debe ser un número >= 0' });
        }
        if (!Number.isInteger(finalDuration) || finalDuration <= 0) {
            return res.status(400).json({ ok: false, msg: 'durationDays debe ser un entero > 0' });
        }

        const startsAt = await getNextStartsAt(driverUid);
        const expiresAt = addDays(startsAt, finalDuration);

        const payment = new Payment({
            driver: driverUid,
            amount: finalAmount,
            durationDays: finalDuration,
            status: 'aprobado',
            createdBy: 'admin',
            adminComment,
            receiptUrl: req.file ? `/api/payments/receipt/${req.file.filename}` : undefined,
            reviewedBy: req.uid,
            reviewedAt: new Date(),
            startsAt,
            expiresAt
        });
        appendEvent(payment, 'creado', req.uid);
        await payment.save();

        io.to(String(driverUid)).emit('payment-approved', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminCreatePayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/payments/admin/settings
const adminGetSettings = async (req, res = response) => {
    try {
        const settings = await getSettings();
        return res.status(200).json({ ok: true, settings });
    } catch (err) {
        console.error('adminGetSettings', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// PUT /api/payments/admin/settings
const adminUpdateSettings = async (req, res = response) => {
    try {
        const allowed = ['driverMonthlyPrice', 'driverMonthlyDurationDays', 'currency'];
        const $set = {};
        for (const k of allowed) {
            if (req.body && req.body[k] !== undefined) $set[k] = req.body[k];
        }
        const settings = await Settings.findOneAndUpdate({}, { $set }, { upsert: true, new: true, setDefaultsOnInsert: true });
        return res.status(200).json({ ok: true, settings });
    } catch (err) {
        console.error('adminUpdateSettings', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

module.exports = {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt,
    adminGetPaymentDetail,
    adminListPayments,
    adminApprovePayment,
    adminRejectPayment,
    adminCreatePayment,
    adminGetSettings,
    adminUpdateSettings
};
