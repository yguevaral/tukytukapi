const { response } = require('express');
const bcrypt = require('bcryptjs');

const Usuario = require('../models/usuario');
const { generarJWT } = require('../helpers/jwt');
const OTPCode = require('../models/otp_code');
const { sendEmailCodeVerification } = require('../helpers/email');
const { status } = require('express/lib/response');

const crearOTP = async (req, res = response ) => {

    const { email, nombre } = req.body;

    try {

        const existeEmail = await Usuario.findOne({ email });
        if( existeEmail ) {
            return res.status(400).json({
                ok: false,
                msg: 'El correo ya está registrado'
            });
        }

        const otpCode = new OTPCode();

        otpCode.code = String(Math.floor(Math.random() * 999999)).padStart(6, '0');
        otpCode.email = email;
        otpCode.name = nombre;
        otpCode.status = 'S';
       
        const emailResponse = await sendEmailCodeVerification(email, nombre, otpCode.code);
        if (!emailResponse) {
            return res.status(500).json({
                ok: false,
                msg: 'Error al enviar el correo electrónico'
            });
        }

        await otpCode.save();

        res.json({
            ok: true,
            msg: 'Correo electrónico, enviado correctamente, verifique su bandeja de entrada',
        });


    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        });
    }
}

const crearUsuario = async (req, res = response ) => {

    const { email, password, code, register_type } = req.body;

    try {

        const existeEmail = await Usuario.findOne({ email });
        if( existeEmail ) {
            return res.status(400).json({
                ok: false,
                msg: 'El correo ya está registrado'
            });
        }

        if( register_type === 'email' ) {
            const existeCodeOTP = await OTPCode.findOne({ code, email, status: 'S' });
            if( !existeCodeOTP ) {
                return res.status(400).json({
                    ok: false,
                    msg: 'El código no es válido'
                });
            }
        }
        
        const usuario = new Usuario( req.body );

        // Encriptar contraseña
        const salt = bcrypt.genSaltSync();
        usuario.password = bcrypt.hashSync( password, salt );

        await usuario.save();

        // Generar mi JWT
        const token = await generarJWT( usuario.id );

        res.json({
            ok: true,
            usuario,
            token
        });


    } catch (error) {
        console.log(error);
        res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        });
    }
}

const login = async ( req, res = response ) => {

    const { email, password } = req.body;

     try {
        
        const usuarioDB = await Usuario.findOne({ email });
        if ( !usuarioDB ) {
            return res.status(404).json({
                ok: false,
                msg: 'Email no encontrado'
            });
        }
        


        // Validar el password
        const validPassword = bcrypt.compareSync( password, usuarioDB.password );
        if ( !validPassword ) {
            return res.status(400).json({
                ok: false,
                msg: 'La contraseña no es valida'
            });
        }

        
        if( usuarioDB.online === true ) {
            return res.status(200).json({
                ok: false,
                msg: 'El usuario ya está conectado'
            }); 
        }



        // Generar el JWT
        const token = await generarJWT( usuarioDB.id );
        
        res.json({
            ok: true,
            msg: '',
            usuario: usuarioDB,
            token
            
        });


    } catch (error) {
        console.log(error);
        return res.status(500).json({
            ok: false,
            msg: 'Hable con el administrador'
        })
    }

}


const renewToken = async( req, res = response) => {

    const uid = req.uid;

    // generar un nuevo JWT, generarJWT... uid...
    const token = await generarJWT( uid );

    // Obtener el usuario por el UID, Usuario.findById... 
    const usuario = await Usuario.findById( uid );

    

    console.log({
        ok: true,
        usuario,
        token
    });

    res.json({
        ok: true,
        usuario,
        token
    });

}


module.exports = {
    crearUsuario,
    login,
    renewToken,
    crearOTP
}
