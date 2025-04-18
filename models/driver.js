const { Schema, model } = require('mongoose');

const DriverSchema = Schema({
    usuario: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    imageProfile: {
        type: String,
        default: ''
    },
    imageDPI1: {
        type: String,
        default: ''
    },
    imageDPI2: {
        type: String,
        default: ''
    },
    plate: {
        type: String,
        default: ''
    },
    locallicense: {
        type: String,
        default: ''
    },
    address: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        default: 'P'
    },
    commentsAdmin: {
        type: String,
        default: ''
    },

}, {
    timestamps: true
});

DriverSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
})

// Virtual populate
DriverSchema.virtual("datausuario", {
    ref: "Usuario",   //must be changed to the name you used for Comment model.
    foreignField: "usuario",
    localField: "_id"
  });



module.exports = model('Driver', DriverSchema );