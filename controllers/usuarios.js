const { response } = require('express');
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



module.exports = {
    getUsuarios,
    setDriverSingin,
    getListDriver,
    adminListDriverSetStatus,
    getDriver
}