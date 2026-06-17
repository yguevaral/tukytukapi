/*
    path: api/usuarios
*/
const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarCampos } = require('../middlewares/validar-campos');
const { check } = require('express-validator');

const {
    getUsuarios,
    setDriverSingin,
    getListDriver,
    adminListDriverSetStatus,
    getDriver,
    adminCreateDriver,
    adminSetSpecialPricing,
    setOnline
} = require('../controllers/usuarios');

const router = Router();

router.get('/', validarJWT, getUsuarios);

router.put('/online', [
    validarJWT,
    check('online', 'online es obligatorio y debe ser booleano').isBoolean(),
    validarCampos
], setOnline);

router.post('/driver/singin', [
    validarJWT,
    check('imageProfile', 'Foto de perfil es obligatorio').not().isEmpty(),
    check('imageDPI1', 'DPI frontal es obligatorio').not().isEmpty(),
    check('imageDPI2', 'DPI posterior es obligatorio').not().isEmpty(),
    check('plate', 'Placa es obligatorio').not().isEmpty(),
    check('locallicense', 'Numero municipal es obligatorio').not().isEmpty(),
    check('address', 'La Direccion es obligatorio').not().isEmpty(),
    validarCampos
], setDriverSingin);

// --- Admin endpoints ---

router.get('/driver/adminListDriverPending', [validarJWT, validarAdmin], getListDriver);

router.put('/driver/adminListDriverSetStatus', [
    validarJWT,
    validarAdmin,
    check('driver', 'driver uid es obligatorio').not().isEmpty(),
    check('driver_status', 'driver_status es obligatorio').not().isEmpty(),
    validarCampos
], adminListDriverSetStatus);

router.post('/driver/admin-create', [
    validarJWT,
    validarAdmin,
    check('nombre', 'nombre obligatorio').not().isEmpty(),
    check('email', 'email obligatorio').isEmail(),
    check('password', 'password obligatorio (mín 4)').isLength({ min: 4 }),
    check('plate', 'placa obligatoria').not().isEmpty(),
    check('locallicense', 'licencia local obligatoria').not().isEmpty(),
    check('address', 'dirección obligatoria').not().isEmpty(),
    validarCampos
], adminCreateDriver);

router.get('/driver', validarJWT, getDriver);

router.put('/admin/:driverUid/special-pricing', [
    validarJWT,
    validarAdmin,
    check('driverUid', 'driverUid obligatorio').not().isEmpty(),
    validarCampos
], adminSetSpecialPricing);

module.exports = router;
