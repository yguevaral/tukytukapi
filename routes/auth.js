/*
    path: api/login

*/
const { Router } = require('express');
const { check } = require('express-validator');

const { crearUsuario, login, renewToken, crearOTP } = require('../controllers/auth');
const { validarCampos } = require('../middlewares/validar-campos');
const { validarJWT } = require('../middlewares/validar-jwt');

const router = Router();



router.post('/new', [
    check('nombre', 'El nombre es obligatorio').not().isEmpty(),
    check('email', 'El correo es obligatorio').isEmail(),
    check('type', 'type es obligatorio').not().isEmpty(),
    check('register_type', 'register_type es obligatorio').not().isEmpty(),
    // Password solo obligatorio cuando registra por email
    check('password').custom((value, { req }) => {
        if (req.body.register_type === 'E' && (!value || value.length < 4)) {
            throw new Error('La contraseña es obligatoria y debe tener al menos 4 caracteres');
        }
        return true;
    }),
    validarCampos
], crearUsuario );

router.post('/', [
    check('password','La contraseña es obligatoria').not().isEmpty(),
    check('email','El correo es obligatorio').isEmail(),
], login );


router.get('/renew', validarJWT, renewToken );

router.post('/otp', [
    check('email','El correo es obligatorio').isEmail(),
], crearOTP );

module.exports = router;
