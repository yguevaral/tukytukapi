const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Garantiza que el directorio existe en arranque (CI, despliegue en fresco)
fs.mkdirSync('uploads/drivers', { recursive: true });

const storage = multer.diskStorage({
    destination: 'uploads/drivers/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const id = crypto.randomBytes(8).toString('hex');
        cb(null, `${Date.now()}-${id}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
        return cb(new Error('TIPO_INVALIDO'), false);
    }
    cb(null, true);
};

module.exports = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});
