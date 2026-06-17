const { io } = require('../index');
const { comprobarJWT } = require('../helpers/jwt');
const { usuarioConectado, usuarioDesconectado, grabarMensaje } = require('../controllers/socket');
const Trip = require('../models/trip');

io.on('connection', (client) => {
    const [valido, uid] = comprobarJWT(client.handshake.headers['x-token']);

    if (!valido) { return client.disconnect(); }

    usuarioConectado(uid);
    client.join(uid);

    client.on('mensaje-personal', async (payload) => {
        await grabarMensaje(payload);
        io.to(payload.para).emit('mensaje-personal', payload);
    });

    client.on('location-update', async ({ tripId, lat, lng }) => {
        try {
            if (!tripId || lat == null || lng == null) return;
            const trip = await Trip.findById(tripId).lean();
            if (!trip) return;
            if (trip.user_status === 'C' || trip.user_status === 'F') return;

            const isUser = String(trip.usuario) === String(uid);
            const isDriver = String(trip.driver) === String(uid);
            if (!isUser && !isDriver) return;

            const counterpart = isUser ? trip.driver : trip.usuario;
            if (!counterpart) return;

            const role = isUser ? 'passenger' : 'driver';
            io.to(String(counterpart)).emit('location-update', {
                tripId,
                role,
                lat,
                lng,
                ts: Date.now()
            });
        } catch (err) {
            console.warn('location-update fail', err.message);
        }
    });

    client.on('disconnect', () => {
        usuarioDesconectado(uid);
    });
});