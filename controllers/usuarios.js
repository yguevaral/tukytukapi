const { response } = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { sendEmailNotificationNewDriverDocs, sendEmailNotificationUserDriverRequestUpdate } = require('../helpers/email');

const getUsuarios = async ( req, res = response ) => {

    const desde = Number( req.query.desde ) || 0;

    const usuarios = await Usuario
        .find({ _id: { $ne: req.uid } })
        .sort('-online')
        .skip(desde)
        .limit(20)

    
    res.json({
        ok: true,
        usuarios,
    })
} 

const setDriverSingin = async ( req, res = response ) => {

    try {

        const usuarioDB = await Usuario.findOne({ _id: req.uid });
        
        if ( !usuarioDB ) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        // delete previous driver
        const driverDB = await Driver.findOne({ usuario: req.uid });
        if ( driverDB ) {
            await Driver.findByIdAndDelete(driverDB._id);
        }
        

        const driver = new Driver( req.body );
        driver.usuario = req.uid;
        driver.save();
        
        // Enviar correo de notificacion al admin
        //await sendEmailNotificationNewDriverDocs(usuarioDB.nombre);
        
        res.json({
            ok: true,
            msg: 'Documentos enviados correctamente, pronto seras contactado por un agente',
        });
        
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        })
        
    }

}


const getListDriver = async ( req, res = response ) => {

    try {

        let drivers = await Driver.find({status : 'P'  });

        let driversUser = [];
        //
        for(let i = 0; i < drivers.length; i++) {
            const driver = drivers[i];
            const usuarioDB = await Usuario.findOne({ _id: driver.usuario });
        
            driversUser.push({driver, usuarioDB});
        }


        res.json({
            ok: true,
            msg: 'Lista de conductores pendientes',
            driversUser
        });
        
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        })
        
    }

}

const adminListDriverSetStatus = async ( req, res = response ) => {

    const driver = await Driver.findOne({ _id: req.body.driver });
    if ( !driver ) {
        return res.status(200).json({
            ok: false,
            msg: 'driver no encontrado'
        });
    }
    
    driver.status = req.body.driver_status;
    driver.commentsAdmin = req.body.commentsAdmin;
    await driver.save();

    const usuarioDriver = await Usuario.findOne({ _id: driver.usuario });
    

    if( driver.status === 'A' ){
        const usuarioDB = await Usuario.findOne({ _id: driver.usuario });
        usuarioDB.type = 'C';
        usuarioDB.save();
        sendEmailNotificationUserDriverRequestUpdate(usuarioDriver.email, usuarioDriver.nombre, 'Tu solicitud ha sido APROBADA, ingresa a la app y comienza a trabajar');
    } 

    if( driver.status === 'R' ){
        sendEmailNotificationUserDriverRequestUpdate(usuarioDriver.email, usuarioDriver.nombre, 'Tu solicitud ha sido RECHAZADA, motivo: ' + req.body.commentsAdmin + ' , ingresa a la app y envia nuevamente tus documentos');
    } 

    res.json({
        ok: true,
        msg: 'driver actualizado',
        driver,
    });
}

const getDriver = async ( req, res = response ) => {

    const driver = await Driver.findOne({ usuario: req.uid });
    if ( !driver ) {
        return res.status(200).json({
            ok: false,
            msg: 'driver no encontrado'
        });
    }


    const usuarioDriver = await Usuario.findOne({ _id: driver.usuario });
    
    res.json({
        ok: true,
        msg: 'driver encontrado',
        driver,
        usuarioDriver
    });
}



const adminCreateDriver = async (req, res = response) => {
    const {
        nombre, apellido = '', email, telefono = '', password,
        imageProfile = '', imageDPI1 = '', imageDPI2 = '',
        plate, locallicense, address
    } = req.body;

    try {
        const existe = await Usuario.findOne({ email });
        if (existe) {
            return res.status(400).json({ ok: false, msg: 'El correo ya está registrado' });
        }

        const salt = bcrypt.genSaltSync();
        const usuario = new Usuario({
            nombre, apellido, email, telefono,
            type: 'C',
            register_type: 'E',
            password: bcrypt.hashSync(password, salt),
        });
        await usuario.save();

        const driver = new Driver({
            usuario: usuario._id,
            imageProfile, imageDPI1, imageDPI2,
            plate, locallicense, address,
            status: 'A',
            commentsAdmin: 'Creado por admin',
        });
        await driver.save();

        return res.json({
            ok: true,
            msg: 'Conductor creado y aprobado',
            usuario,
            driver,
        });
    } catch (e) {
        console.log('adminCreateDriver error', e);
        return res.status(500).json({ ok: false, msg: 'Hable con el administrador' });
    }
};

// PUT /api/usuarios/admin/:driverUid/special-pricing
const adminSetSpecialPricing = async (req, res = response) => {
    try {
        const { driverUid } = req.params;
        const body = req.body || {};
        const $set = {};
        const $unset = {};

        if (body.specialPrice === null) $unset.specialPrice = '';
        else if (body.specialPrice !== undefined) $set.specialPrice = Number(body.specialPrice);

        if (body.specialDurationDays === null) $unset.specialDurationDays = '';
        else if (body.specialDurationDays !== undefined) $set.specialDurationDays = Number(body.specialDurationDays);

        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;

        const driver = await Driver.findOneAndUpdate(
            { usuario: driverUid },
            update,
            { new: true, upsert: false }
        );
        return res.status(200).json({ ok: true, driver });
    } catch (err) {
        console.error('adminSetSpecialPricing', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

module.exports = {
    getUsuarios,
    setDriverSingin,
    getListDriver,
    adminListDriverSetStatus,
    getDriver,
    adminCreateDriver,
    adminSetSpecialPricing
}