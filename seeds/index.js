require('dotenv').config();
const bcrypt = require('bcryptjs');
const { dbConnection } = require('../database/config');
const Usuario = require('../models/usuario');
const Driver = require('../models/driver');

const hash = (pwd) => bcrypt.hashSync(pwd, bcrypt.genSaltSync());

const ensureUser = async ({ email, nombre, type, register_type, password }) => {
    let u = await Usuario.findOne({ email });
    if (u) {
        console.log(`✓ usuario existe: ${email} (type=${u.type})`);
        return u;
    }
    u = new Usuario({
        nombre, email, type, register_type,
        password: password ? hash(password) : undefined,
    });
    await u.save();
    console.log(`+ usuario creado: ${email} (type=${type})`);
    return u;
};

const ensureDriverFor = async (usuario, { plate, locallicense, address }) => {
    let d = await Driver.findOne({ usuario: usuario._id });
    if (d) {
        console.log(`✓ driver existe para ${usuario.email}`);
        return d;
    }
    d = new Driver({
        usuario: usuario._id,
        plate, locallicense, address,
        status: 'A',
        commentsAdmin: 'Seed dev',
    });
    await d.save();
    console.log(`+ driver creado para ${usuario.email}`);
    return d;
};

(async () => {
    try {
        await dbConnection();

        await ensureUser({
            email: 'admin@tukytuk.local',
            nombre: 'Admin',
            type: 'A',
            register_type: 'E',
            password: 'Admin123!',
        });

        const driverUser = await ensureUser({
            email: 'driver@tukytuk.local',
            nombre: 'Driver Seed',
            type: 'C',
            register_type: 'E',
            password: 'Driver123!',
        });

        await ensureDriverFor(driverUser, {
            plate: 'P-001',
            locallicense: 'L-001',
            address: 'Zona 1, Guatemala',
        });

        await ensureUser({
            email: 'user@tukytuk.local',
            nombre: 'Pasajero Seed',
            type: 'U',
            register_type: 'E',
            password: 'User123!',
        });

        console.log('\nSeed completo.');
        process.exit(0);
    } catch (e) {
        console.error('Seed falló:', e);
        process.exit(1);
    }
})();
