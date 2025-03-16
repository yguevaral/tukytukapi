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

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
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


    const trips = await Trip.find({ $and: [{user_status: "S", driver_status: "P"}] }).sort({ createdAt: 'desc' }).limit(10);
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

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
    });
}



module.exports = {
    setUserTrip,
    getUserActiveTrip,
    getUserListTripCompleted,
    getDriverListTrip,
    setDriverAcceptTrip,
    setDriverStatusTrip,
    getDriverActiveTrip
}