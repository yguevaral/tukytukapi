const Settings = require('../models/settings');
const Payment = require('../models/payment');

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

async function getSettings() {
    let s = await Settings.findOne({});
    if (!s) s = await Settings.create({});
    return s;
}

async function getDriverPrice(driver) {
    const settings = await getSettings();
    return {
        amount: driver?.specialPrice ?? settings.driverMonthlyPrice,
        durationDays: driver?.specialDurationDays ?? settings.driverMonthlyDurationDays,
        currency: settings.currency
    };
}

async function isDriverPaid(driverUid) {
    const now = new Date();
    const active = await Payment.findOne({
        driver: driverUid,
        status: 'aprobado',
        expiresAt: { $gt: now }
    }).sort({ expiresAt: -1 });
    return active !== null;
}

async function getNextStartsAt(driverUid) {
    const latest = await Payment.findOne({
        driver: driverUid,
        status: 'aprobado'
    }).sort({ expiresAt: -1 });
    const now = new Date();
    if (!latest || !latest.expiresAt || latest.expiresAt <= now) return now;
    return latest.expiresAt;
}

module.exports = { addDays, getSettings, getDriverPrice, isDriverPaid, getNextStartsAt };
