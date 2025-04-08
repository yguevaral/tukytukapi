const { Schema, model } = require('mongoose');

const OTPCodeSchema = Schema({

    code: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true,

    },
    email: {
        type: String,
        required: true,

    },

    status: {
        type: String,
        default: 'S'
    },
    

}, {
    timestamps: true
});

OTPCodeSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
})



module.exports = model('OTPCode', OTPCodeSchema );