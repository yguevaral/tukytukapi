/*
    path: api/payments
*/
const { Router } = require('express');

const upload = require('../helpers/upload');
const { validarJWT } = require('../middlewares/validar-jwt');
const { validarConductor } = require('../middlewares/validar-conductor');
const paymentsController = require('../controllers/payments');

const router = Router();

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

module.exports = router;
