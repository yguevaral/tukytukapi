const { Schema, model } = require('mongoose');

const UsuarioSchema = Schema({

    nombre: {
        type: String,
        required: true
    },
    apellido: {
        type: String,
        default: ""
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    online: {
        type: Boolean,
        default: false
    },
    type: {
        type: String,
        default: 'U'
    },
    telefono: {
        type: String,
        default: ""
    },
    status: {
        type: String,
        default: "AP"
    },
    register_type: {
        type: String,
        default: "E"
    },

}, {
    timestamps: true
});

UsuarioSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
})



module.exports = model('Usuario', UsuarioSchema );