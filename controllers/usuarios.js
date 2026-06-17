const { response } = require('express');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { sendEmailNotificationNewDriverDocs, sendEmailNotificationUserDriverRequestUpdate } = require('../helpers/email');
const { isDriverPaid, getDriverPrice } = require('../helpers/driverPayment');

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

        if (body.specialPrice === null) {
            $unset.specialPrice = '';
        } else if (body.specialPrice !== undefined) {
            const val = Number(body.specialPrice);
            if (!Number.isFinite(val) || val < 0) {
                return res.status(400).json({ ok: false, msg: 'specialPrice debe ser un número >= 0' });
            }
            $set.specialPrice = val;
        }

        if (body.specialDurationDays === null) {
            $unset.specialDurationDays = '';
        } else if (body.specialDurationDays !== undefined) {
            const val = Number(body.specialDurationDays);
            if (!Number.isInteger(val) || val <= 0) {
                return res.status(400).json({ ok: false, msg: 'specialDurationDays debe ser un entero > 0' });
            }
            $set.specialDurationDays = val;
        }

        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;

        const driver = await Driver.findOneAndUpdate(
            { usuario: driverUid },
            update,
            { new: true, upsert: false }
        );
        if (!driver) {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        return res.status(200).json({ ok: true, driver });
    } catch (err) {
        console.error('adminSetSpecialPricing', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/usuarios/admin/drivers - Lista paginada de conductores con búsqueda
const adminListDrivers = async (req, res = response) => {
    try {
        const { status, search } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);

        const pipeline = [
            { $lookup: { from: 'usuarios', localField: 'usuario', foreignField: '_id', as: 'usuario' } },
            { $unwind: '$usuario' }
        ];

        if (status && ['A', 'R', 'P'].includes(status)) {
            pipeline.push({ $match: { status } });
        }

        if (search && typeof search === 'string' && search.trim()) {
            const regex = { $regex: search.trim(), $options: 'i' };
            pipeline.push({
                $match: {
                    $or: [
                        { 'usuario.nombre': regex },
                        { 'usuario.apellido': regex },
                        { 'usuario.email': regex },
                        { plate: regex }
                    ]
                }
            });
        }

        pipeline.push({
            $facet: {
                drivers: [
                    { $sort: { createdAt: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit }
                ],
                meta: [{ $count: 'total' }]
            }
        });

        const result = await Driver.aggregate(pipeline);
        const rows = result[0]?.drivers ?? [];
        const total = result[0]?.meta?.[0]?.total ?? 0;

        const drivers = rows.map((row) => {
            const { usuario, _id, ...rest } = row;
            return {
                driver: { uid: _id, ...rest },
                usuario: { uid: usuario._id, nombre: usuario.nombre, apellido: usuario.apellido, email: usuario.email, telefono: usuario.telefono }
            };
        });

        return res.status(200).json({ ok: true, drivers, total, page, limit });
    } catch (err) {
        console.error('adminListDrivers', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// GET /api/usuarios/admin/drivers/:uid - Obtener detalle de conductor
const adminGetDriver = async (req, res = response) => {
    try {
        const { uid } = req.params;
        const usuario = await Usuario.findById(uid);
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        const driver = await Driver.findOne({ usuario: uid });
        return res.status(200).json({ ok: true, usuario, driver });
    } catch (err) {
        console.error('adminGetDriver', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// PUT /api/usuarios/admin/drivers/:uid - Actualiza conductor (diff parcial)
const adminUpdateDriver = async (req, res = response) => {
    try {
        const { uid } = req.params;
        const usuario = await Usuario.findById(uid);
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }

        // Siempre cargar el driver al principio
        let driver = await Driver.findOne({ usuario: uid });

        const userFields = ['nombre', 'apellido', 'email', 'telefono'];
        const userUpdate = {};
        for (const f of userFields) {
            if (req.body[f] !== undefined) userUpdate[f] = req.body[f];
        }

        // Validar email duplicado solo si se envía un email diferente al actual
        if (userUpdate.email !== undefined && userUpdate.email !== usuario.email) {
            const existing = await Usuario.findOne({ email: userUpdate.email });
            if (existing && String(existing._id) !== String(usuario._id)) {
                return res.status(409).json({ ok: false, msg: 'email_duplicado' });
            }
        }

        // Aplicar cambios de usuario
        for (const k of Object.keys(userUpdate)) usuario[k] = userUpdate[k];
        if (Object.keys(userUpdate).length) await usuario.save();

        const driverFields = ['plate', 'locallicense', 'address', 'status', 'commentsAdmin'];
        const driverUpdate = {};
        for (const f of driverFields) {
            if (req.body[f] !== undefined) driverUpdate[f] = req.body[f];
        }

        // Aplicar cambios de conductor si existen y el driver fue cargado
        if (Object.keys(driverUpdate).length && driver) {
            for (const k of Object.keys(driverUpdate)) driver[k] = driverUpdate[k];
            await driver.save();
        }

        return res.status(200).json({ ok: true, usuario, driver });
    } catch (err) {
        console.error('adminUpdateDriver', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

// PUT /api/usuarios/online - Gate al ponerse en línea
const setOnline = async (req, res = response) => {
    try {
        const usuario = await Usuario.findById(req.uid);
        if (!usuario) {
            return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
        }
        const wantOnline = req.body && req.body.online === true;
        if (wantOnline && usuario.type === 'C') {
            const paid = await isDriverPaid(req.uid);
            if (!paid) {
                const driver = await Driver.findOne({ usuario: req.uid });
                const price = await getDriverPrice(driver || {});
                return res.status(402).json({
                    ok: false,
                    msg: 'mensualidad_vencida',
                    price
                });
            }
        }
        usuario.online = !!wantOnline;
        await usuario.save();
        return res.status(200).json({ ok: true, usuario });
    } catch (err) {
        console.error('setOnline', { uid: req.uid, err: err.message });
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
    adminSetSpecialPricing,
    adminListDrivers,
    adminGetDriver,
    adminUpdateDriver,
    setOnline
}