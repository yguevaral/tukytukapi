/*
    path: api/payments
*/
const { Router } = require('express');
const { check } = require('express-validator');

const upload = require('../helpers/upload');
const { validarJWT } = require('../middlewares/validar-jwt');
const { validarConductor } = require('../middlewares/validar-conductor');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarCampos } = require('../middlewares/validar-campos');
const paymentsController = require('../controllers/payments');

const router = Router();

// Adapter multer para PATCH (campo 'imagen', opcional)
const uploadPaymentReceiptMw = (req, res, next) => {
    upload.single('imagen')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'archivo_demasiado_grande'
                : err.message === 'TIPO_INVALIDO'
                    ? 'tipo_invalido'
                    : 'error_de_subida';
            return res.status(400).json({ ok: false, msg });
        }
        next();
    });
};

// Rutas del conductor
router.post('/driver/upload',
    [validarJWT, validarConductor, upload.single('receipt')],
    paymentsController.uploadDriverPayment
);

router.get('/driver/list',
    [validarJWT, validarConductor],
    paymentsController.listDriverPayments
);

router.get('/driver/status',
    [validarJWT, validarConductor],
    paymentsController.getDriverStatus
);

// La verificación de dueño/admin ocurre dentro del handler
router.get('/receipt/:filename',
    [validarJWT],
    paymentsController.serveReceipt
);

// Rutas admin
router.get('/admin/list',
    [validarJWT, validarAdmin],
    paymentsController.adminListPayments
);

router.post('/admin/expire-overdue',
    [validarJWT, validarAdmin],
    paymentsController.adminExpireOverdue
);

router.get('/admin/:id',
    [validarJWT, validarAdmin],
    paymentsController.adminGetPaymentDetail
);

router.put('/admin/:id/approve',
    [validarJWT, validarAdmin],
    paymentsController.adminApprovePayment
);

router.put('/admin/:id/reject',
    [
        validarJWT,
        validarAdmin,
        check('adminComment', 'adminComment obligatorio (mín 3)').isLength({ min: 3 }),
        validarCampos
    ],
    paymentsController.adminRejectPayment
);

router.post('/admin/create',
    [
        validarJWT,
        validarAdmin,
        upload.single('receipt'),
        check('driverUid', 'driverUid obligatorio').not().isEmpty(),
        check('adminComment', 'adminComment obligatorio (mín 3)').isLength({ min: 3 }),
        validarCampos
    ],
    paymentsController.adminCreatePayment
);

router.patch('/admin/:id',
    [validarJWT, validarAdmin, uploadPaymentReceiptMw],
    paymentsController.adminPatchPayment
);

router.post('/admin/:id/expire',
    [validarJWT, validarAdmin],
    paymentsController.adminExpirePayment
);

router.get('/admin/settings',
    [validarJWT, validarAdmin],
    paymentsController.adminGetSettings
);

router.put('/admin/settings',
    [validarJWT, validarAdmin],
    paymentsController.adminUpdateSettings
);

module.exports = router;
