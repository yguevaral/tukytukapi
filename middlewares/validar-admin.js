const { response } = require('express');
const Usuario = require('../models/usuario');

const validarAdmin = async (req, res = response, next) => {
    try {
        const uid = req.uid;
        if (!uid) {
            return res.status(401).json({ ok: false, msg: 'No autenticado' });
        }
        const usuario = await Usuario.findById(uid).select('type');
        if (!usuario) {
            return res.status(401).json({ ok: false, msg: 'Usuario no existe' });
        }
        if (usuario.type !== 'A') {
            return res.status(403).json({ ok: false, msg: 'Requiere rol administrador' });
        }
        next();
    } catch (e) {
        console.log('validarAdmin error', e);
        return res.status(500).json({ ok: false, msg: 'Hable con el administrador' });
    }
};

module.exports = { validarAdmin };
