/*
    path: api/usuarios

*/
const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { validarCampos } = require('../middlewares/validar-campos');
const { check } = require('express-validator');

const { getUsuarios, setDriverSingin, getListDriver, adminListDriverSetStatus, getDriver } = require('../controllers/usuarios');

const router = Router();


router.get('/', validarJWT, getUsuarios );

router.post('/driver/singin', [
    check('imageProfile','Foto de perfil es obligatorio').not().isEmpty(),
    check('imageDPI1','DPI frontal es obligatorio').not().isEmpty(),
    check('imageDPI2','DPI posterior es obligatorio').not().isEmpty(),
    check('plate','Placa es obligatorio').not().isEmpty(),
    check('locallicense','Numero municipa es obligatorio').not().isEmpty(),
    check('address','La Direccion es obligatorio').not().isEmpty(),
    validarCampos,
    validarJWT
], setDriverSingin );


router.get('/driver/adminListDriverPending', getListDriver );

router.put('/driver/adminListDriverSetStatus', [
    check('driver','uid_trip es obligatoria').not().isEmpty(),
    check('driver_status','driver_status es obligatoria').not().isEmpty(),
], adminListDriverSetStatus );


router.get('/driver', validarJWT, getDriver );

module.exports = router;
