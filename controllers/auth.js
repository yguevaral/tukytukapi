const { response } = require('express');
const bcrypt = require('bcryptjs');

const Usuario = require('../models/usuario');
const { generarJWT } = require('../helpers/jwt');
const OTPCode = require('../models/otp_code');
const { sendEmailCodeVerification } = require('../helpers/email');
const { status } = require('express/lib/response');
const { verifyGoogleIdToken } = require('../helpers/google-auth');

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

        // Solo para registro por email: validar OTP
        if( register_type === 'E' ) {
            const existeCodeOTP = await OTPCode.findOne({ code, email, status: 'S' });
            if( !existeCodeOTP ) {
                return res.status(400).json({
                    ok: false,
                    msg: 'El código no es válido'
                });
            }
            // Marcar OTP como usado
            existeCodeOTP.status = 'V';
            await existeCodeOTP.save();
        }

        const usuario = new Usuario( req.body );

        // Solo encriptar password si vino (para registro por email)
        if (password) {
            const salt = bcrypt.genSaltSync();
            usuario.password = bcrypt.hashSync(password, salt);
        } else {
            usuario.password = undefined;
        }

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


const loginGoogle = async (req, res = response) => {
    const { idToken, type } = req.body; // type='U' (pasajero, default) o 'C' (conductor)

    try {
        const profile = await verifyGoogleIdToken(idToken);

        let usuario = await Usuario.findOne({ email: profile.email });

        if (!usuario) {
            usuario = new Usuario({
                nombre: profile.givenName || profile.name || profile.email,
                apellido: profile.familyName || '',
                email: profile.email,
                googleId: profile.googleId,
                register_type: 'G',
                type: type === 'C' ? 'U' : 'U', // siempre arranca como usuario; conductor se promueve al aprobar driver request
            });
            await usuario.save();
        } else if (!usuario.googleId) {
            // Existía registrado por email: vinculamos googleId
            usuario.googleId = profile.googleId;
            await usuario.save();
        }

        if (usuario.online === true) {
            return res.status(200).json({
                ok: false,
                msg: 'El usuario ya está conectado'
            });
        }

        const token = await generarJWT(usuario.id);

        res.json({
            ok: true,
            usuario,
            token,
        });
    } catch (error) {
        console.log('loginGoogle error:', error.message);
        return res.status(401).json({
            ok: false,
            msg: 'Token de Google inválido',
        });
    }
};

module.exports = {
    crearUsuario,
    login,
    renewToken,
    crearOTP,
    loginGoogle
}
