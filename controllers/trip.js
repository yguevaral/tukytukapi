const { response } = require('express');
const Trip = require('../models/trip');
const { use } = require('../routes/usuarios');
const usuario = require('../models/usuario');

const setUserTrip = async ( req, res = response ) => {

    const trip = new Trip( req.body );

    trip.usuario = req.uid
    
    await trip.save();

    res.json({
        ok: true,
        msg: 'Trip creado',
        trip,
    });
}

const getUserActiveTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ $and: [{usuario: req.uid, user_status: ["S", "A", "P"]}]}).sort({ createdAt: 'desc' });
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado',
            trip: []
        });
    }    

    const usuario = await Trip.findOne({ $and: [{usuario: trip.driver}]});

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
        usuario
    });
}

const getUserTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ $and: [{uid: req.params.uid .uid}]}).sort({ createdAt: 'desc' });
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado',
            trip: []
        });
    }    

    const usuario = await Trip.findOne({ $and: [{usuario: trip.driver}]});

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
        usuario
    });
}

const getUserListTripCompleted = async ( req, res = response ) => {

    const trips = await Trip.find({ $and: [{usuario: req.uid, user_status: "F"}]}).sort({ createdAt: 'desc' }).limit(10);
    if ( !trips ) {
        return res.status(200).json({
            ok: false,
            msg: 'No hay viajes disponibles',
            tripDB: []
        });
    }
    

    res.json({
        ok: true,
        msg: 'Viajes disponibles',
        trips,
    });
}

const getDriverListTrip = async ( req, res = response ) => {
    try {
        const trips = await Trip.find({
            user_status: 'S',
            usuario: { $ne: req.uid },
            rejectedBy: { $ne: req.uid }
        })
        .sort({ createdAt: 'desc' })
        .limit(10);

        return res.json({
            ok: true,
            msg: 'Viajes disponibles',
            trips,
        });
    } catch (err) {
        console.error('getDriverListTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
}

const setDriverAcceptTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ _id: req.body.uid_trip });
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado'
        });
    }
    
    trip.user_status = "A";
    trip.driver_status = "R";
    trip.driver = req.uid;
    trip.driver_start_lat = req.body.driver_start_lat;
    trip.driver_start_lng = req.body.driver_start_lng;
    await trip.save();

    res.json({
        ok: true,
        msg: 'Trip aceptado',
        trip,
    });
}

const setDriverStatusTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ _id: req.body.uid_trip });
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado'
        });
    }
    
    trip.driver_status = req.body.driver_status;
    if( req.body.driver_status == "F" ) trip.user_status = "F";
    if( req.body.driver_status == "P" ) trip.user_status = "P";
    await trip.save();

    res.json({
        ok: true,
        msg: 'Trip actualizado',
        trip,
    });
}

const getDriverActiveTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ $and: [{driver: req.uid, driver_status: ["R", "P"]}]});
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado',
            trip: []
        });
    }    

    const usuario = await usuario.findOne({ $and: [{usuario: trip.usuario}]});

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
        usuario
    });
}

const cancelUserTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        if (String(trip.usuario) !== String(req.uid)) {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }
        if (trip.user_status !== 'S') {
            return res.status(409).json({
                ok: false,
                msg: 'Solo se puede cancelar mientras está solicitado'
            });
        }
        trip.user_status = 'C';
        trip.cancelledAt = new Date();
        await trip.save();
        return res.status(200).json({ ok: true, msg: 'Trip cancelado', trip });
    } catch (err) {
        console.error('cancelUserTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const setDriverRejectTrip = async (req, res = response) => {
    try {
        const result = await Trip.updateOne(
            { _id: req.body.uid_trip, user_status: 'S' },
            { $addToSet: { rejectedBy: req.uid } }
        );
        if (result.matchedCount === 0) {
            return res.status(409).json({ ok: false, msg: 'Viaje no disponible' });
        }
        return res.status(200).json({ ok: true, msg: 'Viaje rechazado' });
    } catch (err) {
        console.error('setDriverRejectTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

module.exports = {
    setUserTrip,
    getUserActiveTrip,
    getUserListTripCompleted,
    getDriverListTrip,
    setDriverAcceptTrip,
    setDriverStatusTrip,
    getDriverActiveTrip,
    getUserTrip,
    cancelUserTrip,
    setDriverRejectTrip
}