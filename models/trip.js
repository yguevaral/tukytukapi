const { Schema, model } = require('mongoose');

const TripSchema = Schema({
    usuario: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    user_status: {
        type: String,
        default: "S"
    },
    start_lat: {
        type: String,
        required: true
    },
    start_lng: {
        type: String,
        required: true
    },
    end_lat: {
        type: String,
        required: true
    },
    end_lng: {
        type: String,
        required: true
    },
    driver: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: false
    },
    driver_status: {
        type: String,
        default: "P"
    },
    driver_start_lat: {
        type: String,
        default: ""
    },
    driver_start_lng: {
        type: String,
        default: ""
    },


}, {
    timestamps: true
});

TripSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
})



module.exports = model('Trip', TripSchema );