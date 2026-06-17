const { Schema, model } = require('mongoose');

const PaymentSchema = Schema({
    driver: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true,
        index: true
    },
    amount: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pendiente', 'aprobado', 'rechazado'],
        default: 'pendiente',
        index: true
    },
    createdBy: {
        type: String,
        enum: ['driver', 'admin'],
        required: true
    },
    receiptUrl: { type: String },
    adminComment: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    startsAt: { type: Date },
    expiresAt: { type: Date }
}, { timestamps: true });

PaymentSchema.index({ driver: 1, status: 1, expiresAt: -1 });

PaymentSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
});

module.exports = model('Payment', PaymentSchema);
