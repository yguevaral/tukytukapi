const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// DB Config
require('./database/config').dbConnection();


// App de Express
const app = express();

// Lectura y parseo del Body
app.use( express.json({ limit: '5000mb' }) );

// CORS

app.use(cors())


// Node Server
const server = require('http').createServer(app);
module.exports.io = require('socket.io')(server);
require('./sockets/socket');




// Path público
const publicPath = path.resolve( __dirname, 'public' );
app.use( express.static( publicPath ) );



// Mis Rutas
app.use( '/api/login', require('./routes/auth') );
app.use( '/api/usuarios', require('./routes/usuarios') );
app.use( '/api/mensajes', require('./routes/mensajes') );
app.use( '/api/trip', require('./routes/trip') );

server.listen( process.env.PORT, ( err ) => {

    if ( err ) console.log(err);

    console.log('Servidor corriendo en puerto', process.env.PORT );

});
