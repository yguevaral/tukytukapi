/*
    path: api/trip

*/
const { Router } = require('express');
const { check } = require('express-validator');

const tripController = require('../controllers/trip');
const { validarCampos } = require('../middlewares/validar-campos');
const { validarJWT } = require('../middlewares/validar-jwt');

const router = Router();


router.post('/user/new', [
    check('start_lat','start_lat es obligatorio').not().isEmpty(),
    check('start_lng','start_lng es obligatoria').not().isEmpty(),
    check('end_lat','end_lat es obligatoria').not().isEmpty(),
    check('end_lng','end_lat es obligatoria').not().isEmpty(),
    validarCampos,
    validarJWT
], tripController.setUserTrip );

router.get('/user/tripActive', [
    validarJWT
], tripController.getUserActiveTrip );

router.get('/user/listTripCompleted', [
    validarJWT
], tripController.getUserListTripCompleted );

router.get('/driver/tripActive', [
    validarJWT
], tripController.getDriverActiveTrip );

router.get('/driver/listTrip', [
    validarJWT
], tripController.getDriverListTrip );

router.put('/driver/acceptTrip', [
    check('uid_trip','uid_trip es obligatoria').not().isEmpty(),
    check('driver_start_lat','driver_start_lat es obligatoria').not().isEmpty(),
    check('driver_start_lng','driver_start_lng es obligatoria').not().isEmpty(),
    validarJWT
], tripController.setDriverAcceptTrip );

router.put('/driver/statusTrip', [
    check('uid_trip','uid_trip es obligatoria').not().isEmpty(),
    check('driver_status','driver_status es obligatoria').not().isEmpty(),
    validarJWT
], tripController.setDriverStatusTrip );

module.exports = router;
