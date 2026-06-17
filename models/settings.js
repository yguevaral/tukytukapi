const { Schema, model } = require('mongoose');

const SettingsSchema = Schema({
    driverMonthlyPrice: { type: Number, required: true, default: 200 },
    driverMonthlyDurationDays: { type: Number, required: true, default: 30 },
    currency: { type: String, default: 'GTQ' }
}, { timestamps: true });

SettingsSchema.method('toJSON', function() {
    const { __v, _id, ...object } = this.toObject();
    object.uid = _id;
    return object;
});

module.exports = model('Settings', SettingsSchema);
