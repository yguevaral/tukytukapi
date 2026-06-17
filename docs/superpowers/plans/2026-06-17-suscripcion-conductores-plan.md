# Suscripción mensual de conductores — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** Que solo los conductores con el pago al día puedan ponerse en línea, con un sistema completo de pagos gestionados por el admin (subida de comprobantes por el conductor, aprobación/rechazo por el admin, creación manual por el admin para casos especiales, precio configurable global y por conductor).

**Architecture:** Modelos nuevos `Payment` y `Settings` en MongoDB; `Driver` gana `specialPrice`/`specialDurationDays` opcionales. Multer maneja uploads a disco local en `tukytukapi/uploads/payments/`. Helper `driverPayment.js` centraliza `isDriverPaid`/`getDriverPrice`/`getNextStartsAt`. 11 endpoints REST nuevos (4 conductor + 7 admin). Gate al ponerse en línea devuelve 402 si el conductor no está al día. La app Flutter agrega un `PaymentService`, una pantalla `PaymentDriverPage` y un modal bloqueante. El admin web agrega 3 páginas (lista, creación manual, configuración) y un componente `<AuthImage>` para mostrar comprobantes con auth.

**Tech Stack:**
- Backend: Node.js + Express + Mongoose + Socket.IO + **multer** (nuevo). Tests con `node:test`.
- Flutter: `flutter_bloc`, `provider`, `http`, **`image_picker`** (nuevo si no está), `socket_io_client`.
- Admin: React 18 + TS + Vite + MUI + axios.

## Global Constraints

- Idioma: strings de UI, mensajes de error visibles, comentarios nuevos y mensajes de commit en español.
- Convenciones del repo backend: respuestas `{ ok: boolean, msg: string, ... }`. Tests con `node:test` + `node:assert/strict`. Conventional commits en español. Sin Co-author. Sin `--no-verify`. `git add` por nombre de archivo.
- `Usuario.type`: `'U'` (pasajero), `'C'` (conductor), `'A'` (admin).
- `Payment.status` enum exacto: `['pendiente', 'aprobado', 'rechazado']` (strings en español, no `pending`/`approved`/`rejected`).
- `Payment.createdBy` enum exacto: `['driver', 'admin']`.
- Validación de aplicación (en controller, no en schema): si `createdBy === 'driver'` → `receiptUrl` requerido; si `createdBy === 'admin'` → `adminComment` requerido; si `status === 'rechazado'` → `adminComment` requerido.
- Cada `Payment` guarda snapshot inmutable de `amount` y `durationDays`.
- Vigencia se calcula como `expiresAt = startsAt + durationDays` (días, NO mes calendario).
- Acumulación: si el conductor tiene vigencia activa, `startsAt` del nuevo pago = `expiresAt` del último aprobado; si no, `startsAt = now`.
- Upload: límite 5MB, mimetypes `['image/jpeg', 'image/png', 'image/webp']`.
- Currency default: `'GTQ'`. Precio base default: 200. Duración base default: 30 días.
- Carpeta `tukytukapi/uploads/` (y `node_modules/`) deben estar en `.gitignore` — ya lo está; verificar `uploads/` en setup.
- No tocar bugs preexistentes ya conocidos (ej. `controllers/trip.js:44`, `:159`).

---

## Estructura de archivos a tocar

**Backend (`tukytukapi/`):**
- Crear: `models/payment.js`, `models/settings.js`.
- Crear: `helpers/driverPayment.js`, `helpers/upload.js`.
- Crear: `middlewares/validar-conductor.js`.
- Crear: `controllers/payments.js`.
- Crear: `routes/payments.js`.
- Modificar: `models/driver.js` (agregar `specialPrice`, `specialDurationDays`).
- Modificar: `index.js` (montar `/api/payments` router; servir `/api/payments/receipt/:filename` con auth).
- Modificar: `routes/usuarios.js` (agregar `PUT /admin/:driverUid/special-pricing` y `PUT /online`).
- Modificar: `controllers/usuarios.js` (agregar handlers para los 2 endpoints nuevos).
- Modificar: `.gitignore` si `uploads/` no está.
- Tests: `tests/payment-model.test.js`, `tests/settings-model.test.js`, `tests/driver-payment-helper.test.js`, `tests/validar-conductor.test.js`, `tests/payments-driver.test.js`, `tests/payments-admin.test.js`, `tests/usuarios-online-gate.test.js`.

**Flutter (`tukytuk/`):**
- Crear: `lib/services/payment_service.dart`.
- Crear: `lib/models/payment.dart` (modelos `Payment`, `PaymentStatus` model class, `Price`).
- Crear: `lib/pages/payment_driver_page.dart`.
- Crear: `lib/widgets/payment_gate_dialog.dart` (helper para construir el modal bloqueante).
- Modificar: `lib/routes/routes.dart` (agregar `payment_driver`).
- Modificar: `lib/services/socket_service.dart` (listeners `payment-approved`, `payment-rejected`).
- Modificar: pantalla donde el conductor toggle `online` (asume `home_driver` o `trip_driver_page.dart`; el implementer lo descubre y lo conecta).
- Modificar: `pubspec.yaml` (agregar `image_picker` si falta; agregar `http` ya está).
- Tests: `test/payment_service_test.dart`.

**Admin (`tukytuk-admin/`):**
- Crear: `src/api/payments.ts`.
- Crear: `src/components/AuthImage.tsx`.
- Crear: `src/admin/payments/PaymentsListPage.tsx`.
- Crear: `src/admin/payments/CreateManualPaymentPage.tsx`.
- Crear: `src/admin/payments/PaymentSettingsPage.tsx`.
- Modificar: `src/router/AppRouter.jsx` (rutas `/pagos`, `/pagos/nuevo`, `/pagos/configuracion`).
- Modificar: navegación / sidebar del admin para incluir entrada "Pagos".
- Modificar: si existe, `DriverDetailPage` para agregar sección "Precios especiales"; si no existe, queda como follow-up.

---

## Task 1: Modelos Payment, Settings y override en Driver

**Files:**
- Create: `tukytukapi/models/payment.js`
- Create: `tukytukapi/models/settings.js`
- Modify: `tukytukapi/models/driver.js`
- Test: `tukytukapi/tests/payment-model.test.js` (crear)
- Test: `tukytukapi/tests/settings-model.test.js` (crear)

**Interfaces:**
- Produces:
  - `Payment` con campos: `driver: ObjectId(Usuario), amount: Number, durationDays: Number, status: enum ['pendiente','aprobado','rechazado'] default 'pendiente', createdBy: enum ['driver','admin'] required, receiptUrl?: String, adminComment?: String, reviewedBy?: String, reviewedAt?: Date, startsAt?: Date, expiresAt?: Date`. `timestamps: true`. Índices: `{ driver: 1 }` (single), `{ driver: 1, status: 1, expiresAt: -1 }` (compound). `toJSON` omite `__v`/`_id`/`password` y expone `uid`.
  - `Settings` (documento único) con campos: `driverMonthlyPrice: Number required default 200, driverMonthlyDurationDays: Number required default 30, currency: String default 'GTQ'`. `timestamps: true`.
  - `Driver` gana: `specialPrice?: Number, specialDurationDays?: Number`.
- Las tareas siguientes (T2 helper, T4-T6 endpoints) consumen estos modelos.

- [ ] **Paso 1: Crear test del modelo Payment**

Crear `tukytukapi/tests/payment-model.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Payment = require('../models/payment');

test('Payment acepta status pendiente por defecto', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg'
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
    assert.equal(p.status, 'pendiente');
});

test('Payment rechaza status fuera del enum', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        status: 'approved'
    });
    const err = p.validateSync();
    assert.ok(err);
    assert.match(err.errors.status.message, /approved/);
});

test('Payment rechaza createdBy fuera del enum', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'system'
    });
    const err = p.validateSync();
    assert.ok(err);
    assert.match(err.errors.createdBy.message, /system/);
});

test('Payment requiere amount, durationDays, driver y createdBy', () => {
    const p = new Payment({});
    const err = p.validateSync();
    assert.ok(err);
    assert.ok(err.errors.driver);
    assert.ok(err.errors.amount);
    assert.ok(err.errors.durationDays);
    assert.ok(err.errors.createdBy);
});

test('Payment toJSON expone uid y omite __v/_id/password', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 100, durationDays: 30,
        createdBy: 'admin', adminComment: 'pagó en efectivo'
    });
    const json = p.toJSON();
    assert.ok(json.uid);
    assert.equal(json._id, undefined);
    assert.equal(json.__v, undefined);
});
```

- [ ] **Paso 2: Crear test del modelo Settings**

Crear `tukytukapi/tests/settings-model.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../models/settings');

test('Settings tiene defaults driverMonthlyPrice=200, durationDays=30, currency=GTQ', () => {
    const s = new Settings({});
    assert.equal(s.driverMonthlyPrice, 200);
    assert.equal(s.driverMonthlyDurationDays, 30);
    assert.equal(s.currency, 'GTQ');
});

test('Settings acepta override', () => {
    const s = new Settings({ driverMonthlyPrice: 150, driverMonthlyDurationDays: 60, currency: 'USD' });
    assert.equal(s.driverMonthlyPrice, 150);
    assert.equal(s.driverMonthlyDurationDays, 60);
    assert.equal(s.currency, 'USD');
});
```

- [ ] **Paso 3: Correr los tests y confirmar que fallan**

```bash
cd tukytukapi
node --test tests/payment-model.test.js tests/settings-model.test.js
```

Esperado: ambos archivos fallan con `Cannot find module '../models/payment'` y `../models/settings`.

- [ ] **Paso 4: Implementar `models/payment.js`**

Crear `tukytukapi/models/payment.js`:

```js
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
```

- [ ] **Paso 5: Implementar `models/settings.js`**

Crear `tukytukapi/models/settings.js`:

```js
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
```

- [ ] **Paso 6: Modificar `models/driver.js` agregando override**

Agregar dos campos opcionales dentro de la definición del schema, justo antes del cierre del primer objeto:

```js
specialPrice: { type: Number },
specialDurationDays: { type: Number },
```

(Aparecen junto a `commentsAdmin`, antes del `}` del schema. No cambiar ningún otro campo.)

- [ ] **Paso 7: Correr los tests y confirmar que pasan**

```bash
cd tukytukapi
node --test tests/payment-model.test.js tests/settings-model.test.js
```

Esperado: 7 tests pasan.

- [ ] **Paso 8: Correr la suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todos los tests existentes siguen pasando + los 7 nuevos.

- [ ] **Paso 9: Commit**

```bash
cd tukytukapi
git add models/payment.js models/settings.js models/driver.js tests/payment-model.test.js tests/settings-model.test.js
git commit -m "feat(backend): modelos Payment y Settings, override de precio en Driver"
```

---

## Task 2: Helper driverPayment.js (getSettings, getDriverPrice, isDriverPaid, getNextStartsAt, addDays)

**Files:**
- Create: `tukytukapi/helpers/driverPayment.js`
- Test: `tukytukapi/tests/driver-payment-helper.test.js` (crear)

**Interfaces:**
- Consumes: `Payment`, `Settings`, `Driver` (Tarea 1).
- Produces:
  - `addDays(date: Date, days: Number) → Date`
  - `getSettings() → Promise<Settings>` (crea con defaults si no existe).
  - `getDriverPrice(driver: Driver) → Promise<{amount, durationDays, currency}>`. Si `driver.specialPrice`/`specialDurationDays` están definidos los usa; si no, usa Settings.
  - `isDriverPaid(driverUid: String) → Promise<Boolean>` — `true` si existe `Payment.findOne({ driver: driverUid, status: 'aprobado', expiresAt: { $gt: now } })`.
  - `getNextStartsAt(driverUid: String) → Promise<Date>` — vigencia activa → fecha de vencimiento del último aprobado; si no, `now`.
- Tareas 4-7 (endpoints) y T11 (Flutter gate flow) consumen esto.

- [ ] **Paso 1: Crear test del helper**

Crear `tukytukapi/tests/driver-payment-helper.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Settings = require('../models/settings');
const Payment = require('../models/payment');
const { getSettings, getDriverPrice, isDriverPaid, getNextStartsAt, addDays } = require('../helpers/driverPayment');

const stubFindOne = (Model, t, returnValue) => {
    const original = Model.findOne;
    t.after(() => { Model.findOne = original; });
    Model.findOne = (...args) => {
        const chain = { sort: () => Promise.resolve(returnValue) };
        if (typeof returnValue === 'function') {
            return { sort: () => Promise.resolve(returnValue(...args)) };
        }
        return chain.sort();
    };
};

test('addDays suma días correctamente', () => {
    const d = new Date('2026-06-17T12:00:00Z');
    const d2 = addDays(d, 30);
    assert.equal(d2.toISOString(), '2026-07-17T12:00:00.000Z');
});

test('getSettings crea documento con defaults si no existe', async (t) => {
    const origFindOne = Settings.findOne;
    const origCreate = Settings.create;
    t.after(() => { Settings.findOne = origFindOne; Settings.create = origCreate; });

    Settings.findOne = async () => null;
    let createdWith;
    Settings.create = async (doc) => { createdWith = doc; return { driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' }; };

    const s = await getSettings();
    assert.deepEqual(createdWith, {});
    assert.equal(s.driverMonthlyPrice, 200);
});

test('getDriverPrice usa override si specialPrice está presente', async (t) => {
    const origFindOne = Settings.findOne;
    t.after(() => { Settings.findOne = origFindOne; });
    Settings.findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const price = await getDriverPrice({ specialPrice: 150, specialDurationDays: 60 });
    assert.equal(price.amount, 150);
    assert.equal(price.durationDays, 60);
    assert.equal(price.currency, 'GTQ');
});

test('getDriverPrice usa Settings si no hay override', async (t) => {
    const origFindOne = Settings.findOne;
    t.after(() => { Settings.findOne = origFindOne; });
    Settings.findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const price = await getDriverPrice({});
    assert.equal(price.amount, 200);
    assert.equal(price.durationDays, 30);
});

test('isDriverPaid true cuando hay pago aprobado vigente', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve({ uid: 'p1' }) });

    const paid = await isDriverPaid('d1');
    assert.equal(paid, true);
});

test('isDriverPaid false cuando no hay pago vigente', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const paid = await isDriverPaid('d1');
    assert.equal(paid, false);
});

test('getNextStartsAt devuelve expiresAt del último aprobado si está activo', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });

    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const next = await getNextStartsAt('d1');
    assert.equal(next.getTime(), future.getTime());
});

test('getNextStartsAt devuelve now si no hay vigencia activa', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const before = Date.now();
    const next = await getNextStartsAt('d1');
    assert.ok(next.getTime() >= before);
    assert.ok(next.getTime() <= before + 1000);
});
```

- [ ] **Paso 2: Correr test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/driver-payment-helper.test.js
```

Esperado: falla con `Cannot find module '../helpers/driverPayment'`.

- [ ] **Paso 3: Implementar el helper**

Crear `tukytukapi/helpers/driverPayment.js`:

```js
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
```

- [ ] **Paso 4: Correr tests y confirmar que pasan**

```bash
cd tukytukapi
node --test tests/driver-payment-helper.test.js
```

Esperado: 8 tests pasan.

- [ ] **Paso 5: Correr suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 6: Commit**

```bash
cd tukytukapi
git add helpers/driverPayment.js tests/driver-payment-helper.test.js
git commit -m "feat(backend): helper driverPayment con price/paid/nextStartsAt"
```

---

## Task 3: Infraestructura de uploads (multer) y middleware validarConductor

**Files:**
- Create: `tukytukapi/helpers/upload.js`
- Create: `tukytukapi/middlewares/validar-conductor.js`
- Modify: `tukytukapi/.gitignore` (agregar `uploads/` si no está)
- Modify: `tukytukapi/package.json` (agregar `multer`)
- Test: `tukytukapi/tests/validar-conductor.test.js` (crear)

**Interfaces:**
- Produces:
  - `helpers/upload.js`: `module.exports = multerInstance` (un middleware multer configurado con disk storage en `uploads/payments/`, filtro de mimetypes y límite 5MB).
  - `middlewares/validar-conductor.js`: `{ validarConductor: async (req, res, next) }` que verifica `req.uid`, carga usuario, exige `type === 'C'`. Mirrors `validarAdmin`.

- [ ] **Paso 1: Instalar multer**

```bash
cd tukytukapi
npm install multer
```

Verifica que `package.json` ahora liste `multer` en `dependencies`.

- [ ] **Paso 2: Crear carpeta de uploads y actualizar .gitignore**

```bash
cd tukytukapi
mkdir -p uploads/payments
# verifica que .gitignore ignore uploads/
grep -q '^uploads/' .gitignore || echo 'uploads/' >> .gitignore
```

- [ ] **Paso 3: Implementar `helpers/upload.js`**

Crear `tukytukapi/helpers/upload.js`:

```js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
    destination: 'uploads/payments/',
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
```

- [ ] **Paso 4: Crear test de validarConductor**

Crear `tukytukapi/tests/validar-conductor.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const { validarConductor } = require('../middlewares/validar-conductor');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('validarConductor 401 si no hay uid', async () => {
    const req = {};
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(next, false);
});

test('validarConductor 401 si usuario no existe', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => null });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(next, false);
});

test('validarConductor 403 si type no es C', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(next, false);
});

test('validarConductor llama next si type es C', async (t) => {
    const original = Usuario.findById;
    t.after(() => { Usuario.findById = original; });
    Usuario.findById = () => ({ select: async () => ({ type: 'C' }) });

    const req = { uid: 'x' };
    const res = makeRes();
    let next = false;
    await validarConductor(req, res, () => { next = true; });
    assert.equal(next, true);
});
```

- [ ] **Paso 5: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/validar-conductor.test.js
```

Esperado: falla con `Cannot find module`.

- [ ] **Paso 6: Implementar el middleware**

Crear `tukytukapi/middlewares/validar-conductor.js`:

```js
const { response } = require('express');
const Usuario = require('../models/usuario');

const validarConductor = async (req, res = response, next) => {
    try {
        const uid = req.uid;
        if (!uid) {
            return res.status(401).json({ ok: false, msg: 'No autenticado' });
        }
        const usuario = await Usuario.findById(uid).select('type');
        if (!usuario) {
            return res.status(401).json({ ok: false, msg: 'Usuario no existe' });
        }
        if (usuario.type !== 'C') {
            return res.status(403).json({ ok: false, msg: 'Requiere rol conductor' });
        }
        next();
    } catch (e) {
        console.log('validarConductor error', e);
        return res.status(500).json({ ok: false, msg: 'Hable con el administrador' });
    }
};

module.exports = { validarConductor };
```

- [ ] **Paso 7: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/validar-conductor.test.js
```

Esperado: 4 tests pasan.

- [ ] **Paso 8: Correr la suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 9: Commit**

```bash
cd tukytukapi
git add package.json package-lock.json helpers/upload.js middlewares/validar-conductor.js tests/validar-conductor.test.js .gitignore
git commit -m "feat(backend): infra de uploads con multer y middleware validarConductor"
```

---

## Task 4: Endpoints del conductor (upload, list, status, receipt download)

**Files:**
- Create: `tukytukapi/controllers/payments.js`
- Create: `tukytukapi/routes/payments.js`
- Modify: `tukytukapi/index.js` (mount `/api/payments` router)
- Test: `tukytukapi/tests/payments-driver.test.js` (crear)

**Interfaces:**
- Consumes: `Payment`, `Driver`, `helpers/driverPayment`, `middlewares/validar-conductor`, `helpers/upload`.
- Produces (exported by `controllers/payments.js`):
  - `uploadDriverPayment(req, res)` — handler para `POST /driver/upload`.
  - `listDriverPayments(req, res)` — handler para `GET /driver/list`.
  - `getDriverStatus(req, res)` — handler para `GET /driver/status`.
  - `serveReceipt(req, res)` — handler para `GET /receipt/:filename`.
- Endpoints REST (montados en `/api/payments`):
  - `POST /api/payments/driver/upload` (multipart, campo `receipt`).
  - `GET /api/payments/driver/list`.
  - `GET /api/payments/driver/status`.
  - `GET /api/payments/receipt/:filename`.

- [ ] **Paso 1: Crear test de los endpoints del conductor**

Crear `tukytukapi/tests/payments-driver.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt
} = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    sentFile: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    sendFile(p) { this.sentFile = p; return this; },
    setHeader(k, v) { this.headers[k] = v; }
});

test('uploadDriverPayment 400 si no hay archivo', async () => {
    const req = { uid: 'd1', file: null };
    const res = makeRes();
    await uploadDriverPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
});

test('uploadDriverPayment 200 crea Payment pendiente con receiptUrl', async (t) => {
    const origDriverFindOne = Driver.findOne;
    const origPaymentSave = Payment.prototype.save;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Driver.findOne = origDriverFindOne;
        Payment.prototype.save = origPaymentSave;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Driver.findOne = async () => ({ specialPrice: null, specialDurationDays: null });
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    let saved;
    Payment.prototype.save = async function() { saved = this; this._id = new mongoose.Types.ObjectId(); return this; };

    const req = { uid: 'd1', file: { filename: '1234-abc.jpg' } };
    const res = makeRes();
    await uploadDriverPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(saved.status, 'pendiente');
    assert.equal(saved.createdBy, 'driver');
    assert.equal(saved.amount, 200);
    assert.equal(saved.durationDays, 30);
    assert.equal(saved.receiptUrl, '/api/payments/receipt/1234-abc.jpg');
});

test('listDriverPayments devuelve pagos ordenados desc', async (t) => {
    const origFind = Payment.find;
    t.after(() => { Payment.find = origFind; });
    let capturedFilter;
    Payment.find = (filter) => {
        capturedFilter = filter;
        return { sort: () => Promise.resolve([{ uid: 'p1' }, { uid: 'p2' }]) };
    };

    const req = { uid: 'd1' };
    const res = makeRes();
    await listDriverPayments(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payments.length, 2);
    assert.equal(capturedFilter.driver, 'd1');
});

test('getDriverStatus paid=true cuando hay pago aprobado vigente', async (t) => {
    const origPaymentFindOne = Payment.findOne;
    const origDriverFindOne = Driver.findOne;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Payment.findOne = origPaymentFindOne;
        Driver.findOne = origDriverFindOne;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ uid: 'p1', expiresAt: future }) });
    Driver.findOne = async () => ({});
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const req = { uid: 'd1' };
    const res = makeRes();
    await getDriverStatus(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paid, true);
    assert.deepEqual(res.body.price, { amount: 200, durationDays: 30, currency: 'GTQ' });
});

test('serveReceipt 404 si el payment no existe', async (t) => {
    const origFindOne = Payment.findOne;
    t.after(() => { Payment.findOne = origFindOne; });
    Payment.findOne = async () => null;

    const req = { uid: 'd1', params: { filename: 'no-existe.jpg' } };
    const res = makeRes();
    await serveReceipt(req, res);
    assert.equal(res.statusCode, 404);
});

test('serveReceipt 403 si el solicitante no es dueño ni admin', async (t) => {
    const origPaymentFindOne = Payment.findOne;
    const origUsuarioFindById = Usuario.findById;
    t.after(() => {
        Payment.findOne = origPaymentFindOne;
        Usuario.findById = origUsuarioFindById;
    });
    Payment.findOne = async () => ({ driver: 'd1', receiptUrl: '/api/payments/receipt/x.jpg' });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'otro', params: { filename: 'x.jpg' } };
    const res = makeRes();
    await serveReceipt(req, res);
    assert.equal(res.statusCode, 403);
});
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/payments-driver.test.js
```

Esperado: falla con `Cannot find module '../controllers/payments'`.

- [ ] **Paso 3: Crear `controllers/payments.js` con los 4 handlers**

Crear `tukytukapi/controllers/payments.js`:

```js
const { response } = require('express');
const path = require('path');
const fs = require('fs');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');
const { getDriverPrice, getSettings, isDriverPaid } = require('../helpers/driverPayment');

const uploadDriverPayment = async (req, res = response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, msg: 'Falta el comprobante' });
        }
        const driver = await Driver.findOne({ usuario: req.uid });
        const { amount, durationDays } = await getDriverPrice(driver || {});

        const payment = new Payment({
            driver: req.uid,
            amount,
            durationDays,
            status: 'pendiente',
            createdBy: 'driver',
            receiptUrl: `/api/payments/receipt/${req.file.filename}`
        });
        await payment.save();
        return res.status(200).json({ ok: true, msg: 'Comprobante recibido', payment });
    } catch (err) {
        console.error('uploadDriverPayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const listDriverPayments = async (req, res = response) => {
    try {
        const payments = await Payment.find({ driver: req.uid }).sort({ createdAt: -1 });
        return res.status(200).json({ ok: true, payments });
    } catch (err) {
        console.error('listDriverPayments', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const getDriverStatus = async (req, res = response) => {
    try {
        const driver = await Driver.findOne({ usuario: req.uid });
        const price = await getDriverPrice(driver || {});
        const now = new Date();
        const activePayment = await Payment.findOne({
            driver: req.uid,
            status: 'aprobado',
            expiresAt: { $gt: now }
        }).sort({ expiresAt: -1 });
        return res.status(200).json({
            ok: true,
            paid: !!activePayment,
            activePayment,
            price
        });
    } catch (err) {
        console.error('getDriverStatus', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const serveReceipt = async (req, res = response) => {
    try {
        const { filename } = req.params;
        const payment = await Payment.findOne({
            receiptUrl: `/api/payments/receipt/${filename}`
        });
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Comprobante no encontrado' });
        }
        const isOwner = String(payment.driver) === String(req.uid);
        if (!isOwner) {
            const usuario = await Usuario.findById(req.uid).select('type');
            if (!usuario || usuario.type !== 'A') {
                return res.status(403).json({ ok: false, msg: 'No autorizado' });
            }
        }
        const filePath = path.resolve('uploads/payments', filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
        }
        return res.sendFile(filePath);
    } catch (err) {
        console.error('serveReceipt', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

module.exports = {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt
};
```

- [ ] **Paso 4: Crear `routes/payments.js` con las rutas del conductor**

Crear `tukytukapi/routes/payments.js`:

```js
/*
    path: api/payments
*/
const { Router } = require('express');

const upload = require('../helpers/upload');
const { validarJWT } = require('../middlewares/validar-jwt');
const { validarConductor } = require('../middlewares/validar-conductor');
const paymentsController = require('../controllers/payments');

const router = Router();

// Rutas del conductor
router.post('/driver/upload',
    [validarJWT, validarConductor, upload.single('receipt')],
    paymentsController.uploadDriverPayment
);

router.get('/driver/list',
    [validarJWT, validarConductor],
    paymentsController.listDriverPayments
);

router.get('/driver/status',
    [validarJWT, validarConductor],
    paymentsController.getDriverStatus
);

router.get('/receipt/:filename',
    [validarJWT],
    paymentsController.serveReceipt
);

module.exports = router;
```

- [ ] **Paso 5: Montar el router en `index.js`**

Editar `tukytukapi/index.js`. Cerca de los `app.use('/api/...', require('./routes/...'))`, agregar:

```js
app.use('/api/payments', require('./routes/payments'));
```

- [ ] **Paso 6: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/payments-driver.test.js
```

Esperado: 6 tests pasan.

- [ ] **Paso 7: Correr suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todos los tests pasan.

- [ ] **Paso 8: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js index.js tests/payments-driver.test.js
git commit -m "feat(backend): endpoints conductor upload/list/status/receipt"
```

---

## Task 5: Endpoints admin de pagos (list, approve, reject, create manual)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (agregar 4 handlers admin)
- Modify: `tukytukapi/routes/payments.js` (agregar 4 rutas admin)
- Test: `tukytukapi/tests/payments-admin.test.js` (crear)

**Interfaces:**
- Consumes: `Payment`, `Driver`, `helpers/driverPayment` (`getDriverPrice`, `getNextStartsAt`, `addDays`), `middlewares/validar-admin`, `helpers/upload`. Para emit socket: lazy `require('../index').io` (mismo patrón del Spec 1 T4).
- Produces:
  - `adminListPayments(req, res)` — `GET /admin/list?status&driverUid&page&limit`.
  - `adminApprovePayment(req, res)` — `PUT /admin/:id/approve`.
  - `adminRejectPayment(req, res)` — `PUT /admin/:id/reject` (requiere `adminComment`).
  - `adminCreatePayment(req, res)` — `POST /admin/create` (requiere `driverUid` y `adminComment`).
- Socket events emitidos a la sala del conductor (`String(driverUid)`): `payment-approved`, `payment-rejected`.

- [ ] **Paso 1: Crear test de los endpoints admin**

Crear `tukytukapi/tests/payments-admin.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const ioCalls = [];
const fakeIo = {
    to(room) { return { emit(event, payload) { ioCalls.push({ room, event, payload }); } }; }
};

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) {
        return { io: fakeIo };
    }
    return originalLoad(request, parent, isMain);
};

const {
    adminListPayments,
    adminApprovePayment,
    adminRejectPayment,
    adminCreatePayment
} = require('../controllers/payments');

test.after(() => { Module._load = originalLoad; });

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListPayments aplica filtros opcionales', async (t) => {
    const origFind = Payment.find;
    const origCount = Payment.countDocuments;
    t.after(() => { Payment.find = origFind; Payment.countDocuments = origCount; });

    let captured;
    Payment.find = (filter) => {
        captured = filter;
        return {
            sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) })
        };
    };
    Payment.countDocuments = async () => 0;

    const req = { query: { status: 'pendiente', driverUid: 'd1', page: '1', limit: '20' } };
    const res = makeRes();
    await adminListPayments(req, res);
    assert.equal(captured.status, 'pendiente');
    assert.equal(captured.driver, 'd1');
});

test('adminApprovePayment 409 si pago no está pendiente', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });
    Payment.findById = async () => ({ status: 'aprobado', save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminApprovePayment 200 setea startsAt/expiresAt y emite socket', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Payment.findById = origFindById;
        Payment.findOne = origPaymentFindOne;
    });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) }); // no vigencia activa

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'aprobado');
    assert.equal(paymentDoc.reviewedBy, 'a1');
    assert.ok(paymentDoc.startsAt);
    assert.ok(paymentDoc.expiresAt);
    const diffDays = (paymentDoc.expiresAt - paymentDoc.startsAt) / (1000 * 60 * 60 * 24);
    assert.equal(Math.round(diffDays), 30);
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(driverId));
    assert.equal(ioCalls[0].event, 'payment-approved');
});

test('adminApprovePayment acumula días si hay vigencia activa', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Payment.findById = origFindById;
        Payment.findOne = origPaymentFindOne;
    });

    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(paymentDoc.startsAt.getTime(), future.getTime());
});

test('adminRejectPayment requiere adminComment', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });
    Payment.findById = async () => ({ status: 'pendiente', driver: 'd1', save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'p1' }, body: {} };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminRejectPayment 200 con adminComment y emite payment-rejected', async (t) => {
    ioCalls.length = 0;
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        status: 'pendiente',
        driver: driverId,
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'a1', params: { id: 'p1' }, body: { adminComment: 'foto borrosa' } };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'rechazado');
    assert.equal(paymentDoc.adminComment, 'foto borrosa');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].event, 'payment-rejected');
});

test('adminCreatePayment requiere adminComment', async (t) => {
    const req = { uid: 'a1', body: { driverUid: 'd1' }, file: null };
    const res = makeRes();
    await adminCreatePayment(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminCreatePayment 200 con adminComment crea Payment aprobado y emite socket', async (t) => {
    ioCalls.length = 0;
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    const origPaymentSave = Payment.prototype.save;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
        Payment.prototype.save = origPaymentSave;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Usuario.findById = () => ({ select: async () => ({ type: 'C' }) });
    Driver.findOne = async () => ({});
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    let saved;
    Payment.prototype.save = async function() { saved = this; this._id = new mongoose.Types.ObjectId(); return this; };

    const req = {
        uid: 'a1',
        body: { driverUid: 'd1', adminComment: 'pagó en efectivo' },
        file: null
    };
    const res = makeRes();
    await adminCreatePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.status, 'aprobado');
    assert.equal(saved.createdBy, 'admin');
    assert.equal(saved.adminComment, 'pagó en efectivo');
    assert.equal(saved.reviewedBy, 'a1');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].event, 'payment-approved');
});
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/payments-admin.test.js
```

Esperado: falla porque los handlers admin todavía no se exportan.

- [ ] **Paso 3: Agregar los 4 handlers admin a `controllers/payments.js`**

Editar `tukytukapi/controllers/payments.js`. Agregar al inicio del archivo (junto a los requires existentes):

```js
const { getNextStartsAt, addDays } = require('../helpers/driverPayment');
```

Agregar los 4 handlers antes del `module.exports`:

```js
const adminListPayments = async (req, res = response) => {
    try {
        const { status, driverUid } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const filter = {};
        if (status) filter.status = status;
        if (driverUid) filter.driver = driverUid;

        const [payments, total] = await Promise.all([
            Payment.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Payment.countDocuments(filter)
        ]);
        return res.status(200).json({ ok: true, payments, total, page, limit });
    } catch (err) {
        console.error('adminListPayments', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const adminApprovePayment = async (req, res = response) => {
    try {
        const { io } = require('../index');
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status !== 'pendiente') {
            return res.status(409).json({ ok: false, msg: 'Pago ya no está pendiente' });
        }
        payment.startsAt = await getNextStartsAt(payment.driver);
        payment.expiresAt = addDays(payment.startsAt, payment.durationDays);
        payment.status = 'aprobado';
        payment.reviewedBy = req.uid;
        payment.reviewedAt = new Date();
        await payment.save();

        io.to(String(payment.driver)).emit('payment-approved', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminApprovePayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const adminRejectPayment = async (req, res = response) => {
    try {
        const { adminComment } = req.body || {};
        if (!adminComment || String(adminComment).trim().length < 3) {
            return res.status(400).json({ ok: false, msg: 'adminComment es obligatorio (mínimo 3 caracteres)' });
        }
        const { io } = require('../index');
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status !== 'pendiente') {
            return res.status(409).json({ ok: false, msg: 'Pago ya no está pendiente' });
        }
        payment.status = 'rechazado';
        payment.adminComment = adminComment;
        payment.reviewedBy = req.uid;
        payment.reviewedAt = new Date();
        await payment.save();

        io.to(String(payment.driver)).emit('payment-rejected', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminRejectPayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const adminCreatePayment = async (req, res = response) => {
    try {
        const { driverUid, adminComment, amount, durationDays } = req.body || {};
        if (!driverUid) {
            return res.status(400).json({ ok: false, msg: 'driverUid es obligatorio' });
        }
        if (!adminComment || String(adminComment).trim().length < 3) {
            return res.status(400).json({ ok: false, msg: 'adminComment es obligatorio (mínimo 3 caracteres)' });
        }
        const usuario = await Usuario.findById(driverUid).select('type');
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        const { io } = require('../index');
        const driver = await Driver.findOne({ usuario: driverUid });
        const price = await getDriverPrice(driver || {});
        const finalAmount = amount != null ? Number(amount) : price.amount;
        const finalDuration = durationDays != null ? Number(durationDays) : price.durationDays;

        const startsAt = await getNextStartsAt(driverUid);
        const expiresAt = addDays(startsAt, finalDuration);

        const payment = new Payment({
            driver: driverUid,
            amount: finalAmount,
            durationDays: finalDuration,
            status: 'aprobado',
            createdBy: 'admin',
            adminComment,
            receiptUrl: req.file ? `/api/payments/receipt/${req.file.filename}` : undefined,
            reviewedBy: req.uid,
            reviewedAt: new Date(),
            startsAt,
            expiresAt
        });
        await payment.save();

        io.to(String(driverUid)).emit('payment-approved', { payment });
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminCreatePayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Actualizar `module.exports`:

```js
module.exports = {
    uploadDriverPayment,
    listDriverPayments,
    getDriverStatus,
    serveReceipt,
    adminListPayments,
    adminApprovePayment,
    adminRejectPayment,
    adminCreatePayment
};
```

- [ ] **Paso 4: Agregar las rutas admin a `routes/payments.js`**

Editar `tukytukapi/routes/payments.js`. Importar `validarAdmin` y `upload`. Agregar antes del `module.exports`:

```js
const { validarAdmin } = require('../middlewares/validar-admin');
// ...

// Rutas admin
router.get('/admin/list',
    [validarJWT, validarAdmin],
    paymentsController.adminListPayments
);

router.put('/admin/:id/approve',
    [validarJWT, validarAdmin],
    paymentsController.adminApprovePayment
);

router.put('/admin/:id/reject',
    [validarJWT, validarAdmin],
    paymentsController.adminRejectPayment
);

router.post('/admin/create',
    [validarJWT, validarAdmin, upload.single('receipt')],
    paymentsController.adminCreatePayment
);
```

- [ ] **Paso 5: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/payments-admin.test.js
```

Esperado: 8 tests pasan.

- [ ] **Paso 6: Correr la suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 7: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js tests/payments-admin.test.js
git commit -m "feat(backend): endpoints admin pagos list/approve/reject/create-manual"
```

---

## Task 6: Endpoints admin de configuración (settings y special-pricing)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (agregar 2 handlers de settings)
- Modify: `tukytukapi/routes/payments.js` (agregar rutas settings)
- Modify: `tukytukapi/controllers/usuarios.js` (agregar `adminSetSpecialPricing`)
- Modify: `tukytukapi/routes/usuarios.js` (agregar ruta `PUT /admin/:driverUid/special-pricing`)
- Test: ampliar `tukytukapi/tests/payments-admin.test.js` (agregar 4 tests) o crear `tukytukapi/tests/settings-endpoints.test.js`.

**Interfaces:**
- Produces:
  - `adminGetSettings(req, res)` — `GET /api/payments/admin/settings`.
  - `adminUpdateSettings(req, res)` — `PUT /api/payments/admin/settings`.
  - `adminSetSpecialPricing(req, res)` — `PUT /api/usuarios/admin/:driverUid/special-pricing` (en `controllers/usuarios.js`). Acepta body `{ specialPrice?, specialDurationDays? }`. `null` borra el override.

- [ ] **Paso 1: Crear test `tukytukapi/tests/settings-endpoints.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Settings = require('../models/settings');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const { adminGetSettings, adminUpdateSettings } = require('../controllers/payments');
const { adminSetSpecialPricing } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetSettings crea defaults si no existe', async (t) => {
    const origFindOne = Settings.findOne;
    const origCreate = Settings.create;
    t.after(() => { Settings.findOne = origFindOne; Settings.create = origCreate; });
    Settings.findOne = async () => null;
    let createdWith;
    Settings.create = async (d) => { createdWith = d; return { driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' }; };

    const req = { uid: 'a1' };
    const res = makeRes();
    await adminGetSettings(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.driverMonthlyPrice, 200);
    assert.deepEqual(createdWith, {});
});

test('adminUpdateSettings hace upsert', async (t) => {
    const origFindOneAndUpdate = Settings.findOneAndUpdate;
    t.after(() => { Settings.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Settings.findOneAndUpdate = async (filter, update, opts) => {
        captured = { filter, update, opts };
        return { driverMonthlyPrice: 250, driverMonthlyDurationDays: 30, currency: 'GTQ' };
    };

    const req = { uid: 'a1', body: { driverMonthlyPrice: 250 } };
    const res = makeRes();
    await adminUpdateSettings(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(captured.opts.upsert, true);
    assert.deepEqual(captured.update.$set, { driverMonthlyPrice: 250 });
});

test('adminSetSpecialPricing actualiza al Driver', async (t) => {
    const origFindOneAndUpdate = Driver.findOneAndUpdate;
    t.after(() => { Driver.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Driver.findOneAndUpdate = async (filter, update, opts) => {
        captured = { filter, update, opts };
        return { specialPrice: 150, specialDurationDays: 60 };
    };

    const req = { uid: 'a1', params: { driverUid: 'd1' }, body: { specialPrice: 150, specialDurationDays: 60 } };
    const res = makeRes();
    await adminSetSpecialPricing(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.filter, { usuario: 'd1' });
    assert.equal(captured.update.$set.specialPrice, 150);
    assert.equal(captured.update.$set.specialDurationDays, 60);
});

test('adminSetSpecialPricing acepta null para borrar override', async (t) => {
    const origFindOneAndUpdate = Driver.findOneAndUpdate;
    t.after(() => { Driver.findOneAndUpdate = origFindOneAndUpdate; });

    let captured;
    Driver.findOneAndUpdate = async (filter, update, opts) => {
        captured = update;
        return {};
    };

    const req = { uid: 'a1', params: { driverUid: 'd1' }, body: { specialPrice: null, specialDurationDays: null } };
    const res = makeRes();
    await adminSetSpecialPricing(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(captured.$unset);
    assert.deepEqual(Object.keys(captured.$unset).sort(), ['specialDurationDays', 'specialPrice']);
});
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/settings-endpoints.test.js
```

Esperado: falla con handlers no exportados.

- [ ] **Paso 3: Implementar `adminGetSettings` y `adminUpdateSettings` en `controllers/payments.js`**

Agregar antes del `module.exports`:

```js
const { getSettings } = require('../helpers/driverPayment');

const adminGetSettings = async (req, res = response) => {
    try {
        const settings = await getSettings();
        return res.status(200).json({ ok: true, settings });
    } catch (err) {
        console.error('adminGetSettings', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};

const adminUpdateSettings = async (req, res = response) => {
    try {
        const allowed = ['driverMonthlyPrice', 'driverMonthlyDurationDays', 'currency'];
        const $set = {};
        for (const k of allowed) {
            if (req.body && req.body[k] !== undefined) $set[k] = req.body[k];
        }
        const settings = await Settings.findOneAndUpdate({}, { $set }, { upsert: true, new: true, setDefaultsOnInsert: true });
        return res.status(200).json({ ok: true, settings });
    } catch (err) {
        console.error('adminUpdateSettings', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar también el require de `Settings` al inicio del archivo (si no está):
```js
const Settings = require('../models/settings');
```

Actualizar `module.exports` para incluir `adminGetSettings` y `adminUpdateSettings`.

- [ ] **Paso 4: Implementar `adminSetSpecialPricing` en `controllers/usuarios.js`**

Al inicio del archivo, asegurar que `Driver` está importado: `const Driver = require('../models/driver');`. Agregar el handler:

```js
const adminSetSpecialPricing = async (req, res = response) => {
    try {
        const { driverUid } = req.params;
        const body = req.body || {};
        const $set = {};
        const $unset = {};

        if (body.specialPrice === null) $unset.specialPrice = '';
        else if (body.specialPrice !== undefined) $set.specialPrice = Number(body.specialPrice);

        if (body.specialDurationDays === null) $unset.specialDurationDays = '';
        else if (body.specialDurationDays !== undefined) $set.specialDurationDays = Number(body.specialDurationDays);

        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;

        const driver = await Driver.findOneAndUpdate(
            { usuario: driverUid },
            update,
            { new: true, upsert: false }
        );
        return res.status(200).json({ ok: true, driver });
    } catch (err) {
        console.error('adminSetSpecialPricing', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Exportar añadiendo `adminSetSpecialPricing` al `module.exports` existente del archivo.

- [ ] **Paso 5: Agregar rutas en `routes/payments.js` y `routes/usuarios.js`**

En `routes/payments.js`, junto a las demás rutas admin:

```js
router.get('/admin/settings',
    [validarJWT, validarAdmin],
    paymentsController.adminGetSettings
);

router.put('/admin/settings',
    [validarJWT, validarAdmin],
    paymentsController.adminUpdateSettings
);
```

En `routes/usuarios.js`, importar el nuevo handler (agregarlo al destructuring del controllers/usuarios) y agregar:

```js
router.put('/admin/:driverUid/special-pricing', [
    validarJWT,
    validarAdmin,
    check('driverUid', 'driverUid obligatorio').not().isEmpty(),
    validarCampos
], adminSetSpecialPricing);
```

- [ ] **Paso 6: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/settings-endpoints.test.js
```

Esperado: 4 tests pasan.

- [ ] **Paso 7: Correr la suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 8: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js controllers/usuarios.js routes/usuarios.js tests/settings-endpoints.test.js
git commit -m "feat(backend): admin settings de pagos y special-pricing por conductor"
```

---

## Task 7: Gate al ponerse en línea (PUT /api/usuarios/online)

**Files:**
- Modify: `tukytukapi/controllers/usuarios.js` (agregar `setOnline`)
- Modify: `tukytukapi/routes/usuarios.js` (agregar `PUT /online`)
- Test: `tukytukapi/tests/usuarios-online-gate.test.js` (crear)

**Interfaces:**
- Consumes: `Usuario`, `helpers/driverPayment` (`isDriverPaid`, `getDriverPrice`), `Driver`.
- Produces:
  - `setOnline(req, res)` — handler para `PUT /api/usuarios/online`. Body `{ online: boolean }`. Si `online === true` y `usuario.type === 'C'` y `!isDriverPaid` → 402. Sino actualiza `usuario.online` y devuelve OK.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/usuarios-online-gate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const Payment = require('../models/payment');

const { setOnline } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('setOnline 200 si pasajero pone online=true', async (t) => {
    const origFindById = Usuario.findById;
    t.after(() => { Usuario.findById = origFindById; });

    Usuario.findById = async () => ({
        type: 'U', online: false,
        save: async function() { return this; }
    });

    const req = { uid: 'u1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
});

test('setOnline 402 si conductor sin pago intenta online=true', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    const origSettingsFindOne = require('../models/settings').findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
        require('../models/settings').findOne = origSettingsFindOne;
    });

    Usuario.findById = async () => ({ type: 'C', online: false, save: async function() { return this; } });
    Driver.findOne = async () => ({});
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) }); // sin vigencia
    require('../models/settings').findOne = async () => ({ driverMonthlyPrice: 200, driverMonthlyDurationDays: 30, currency: 'GTQ' });

    const req = { uid: 'd1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.msg, 'mensualidad_vencida');
    assert.deepEqual(res.body.price, { amount: 200, durationDays: 30, currency: 'GTQ' });
});

test('setOnline 200 si conductor al día pone online=true', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    const origDriverFindOne = Driver.findOne;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => {
        Usuario.findById = origUsuarioFindById;
        Driver.findOne = origDriverFindOne;
        Payment.findOne = origPaymentFindOne;
    });

    const usuarioDoc = { type: 'C', online: false, save: async function() { return this; } };
    Usuario.findById = async () => usuarioDoc;
    Driver.findOne = async () => ({});
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    Payment.findOne = () => ({ sort: () => Promise.resolve({ expiresAt: future }) });

    const req = { uid: 'd1', body: { online: true } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.online, true);
});

test('setOnline 200 si conductor pone online=false sin gate', async (t) => {
    const origUsuarioFindById = Usuario.findById;
    t.after(() => { Usuario.findById = origUsuarioFindById; });

    const usuarioDoc = { type: 'C', online: true, save: async function() { return this; } };
    Usuario.findById = async () => usuarioDoc;

    const req = { uid: 'd1', body: { online: false } };
    const res = makeRes();
    await setOnline(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.online, false);
});
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/usuarios-online-gate.test.js
```

Esperado: falla porque `setOnline` no existe.

- [ ] **Paso 3: Implementar `setOnline` en `controllers/usuarios.js`**

Agregar al inicio del archivo (junto a otros requires):
```js
const { isDriverPaid, getDriverPrice } = require('../helpers/driverPayment');
```

(`Driver` ya está importado por la Tarea 6.)

Agregar el handler antes del `module.exports`:

```js
const setOnline = async (req, res = response) => {
    try {
        const usuario = await Usuario.findById(req.uid);
        if (!usuario) {
            return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
        }
        const wantOnline = req.body && req.body.online === true;
        if (wantOnline && usuario.type === 'C') {
            const paid = await isDriverPaid(req.uid);
            if (!paid) {
                const driver = await Driver.findOne({ usuario: req.uid });
                const price = await getDriverPrice(driver || {});
                return res.status(402).json({
                    ok: false,
                    msg: 'mensualidad_vencida',
                    price
                });
            }
        }
        usuario.online = !!wantOnline;
        await usuario.save();
        return res.status(200).json({ ok: true, usuario });
    } catch (err) {
        console.error('setOnline', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar `setOnline` al `module.exports`.

- [ ] **Paso 4: Agregar la ruta `PUT /online` en `routes/usuarios.js`**

Importar `setOnline` al destructuring de `require('../controllers/usuarios')`. Agregar:

```js
router.put('/online', [
    validarJWT,
    check('online', 'online es obligatorio y debe ser booleano').isBoolean(),
    validarCampos
], setOnline);
```

- [ ] **Paso 5: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/usuarios-online-gate.test.js
```

Esperado: 4 tests pasan.

- [ ] **Paso 6: Correr la suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 7: Commit**

```bash
cd tukytukapi
git add controllers/usuarios.js routes/usuarios.js tests/usuarios-online-gate.test.js
git commit -m "feat(backend): gate al ponerse online valida pago del conductor"
```

---

## Task 8: Flutter — PaymentService y modelos

**Files:**
- Create: `tukytuk/lib/models/payment.dart`
- Create: `tukytuk/lib/services/payment_service.dart`
- Modify: `tukytuk/pubspec.yaml` (agregar `image_picker` si falta)
- Test: `tukytuk/test/payment_service_test.dart` (crear)

**Interfaces:**
- Consumes: `Constants.apiUrl`, `AuthService.getToken()`.
- Produces:
  - `class Price { final num amount; final int durationDays; final String currency; ... }` — fromJson.
  - `class Payment { final String uid; final String driver; final num amount; final int durationDays; final String status; final String createdBy; final String? receiptUrl; final String? adminComment; final DateTime? startsAt; final DateTime? expiresAt; ... }` — fromJson tolerante (usa `DateTime.tryParse`).
  - `class PaymentStatus { final bool paid; final Payment? activePayment; final Price price; }` — fromJson.
  - `class PaymentService { Future<PaymentStatus> getStatus(); Future<List<Payment>> getList(); Future<Payment?> uploadReceipt(File image); }`. Métodos devuelven null/lista vacía en error (alineado con el patrón existente de TripService).

- [ ] **Paso 1: Verificar / agregar `image_picker`**

```bash
cd tukytuk
grep -E '^\s*image_picker:' pubspec.yaml || \
  (echo "  image_picker: ^1.0.0" >> /tmp/pp.txt && echo "ATENCION: agrega 'image_picker: ^1.0.0' bajo dependencies en pubspec.yaml y corre flutter pub get")
```

Si `image_picker` no estaba, edita `tukytuk/pubspec.yaml` para agregar la dependencia, luego:

```bash
cd tukytuk
flutter pub get
```

- [ ] **Paso 2: Crear el test del servicio**

Crear `tukytuk/test/payment_service_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tukytuk/models/payment.dart';

void main() {
  group('Payment model', () {
    test('Payment.fromJson tolera fechas null', () {
      final json = {
        'uid': 'p1',
        'driver': 'd1',
        'amount': 200,
        'durationDays': 30,
        'status': 'pendiente',
        'createdBy': 'driver',
        'receiptUrl': '/api/payments/receipt/x.jpg',
      };
      final p = Payment.fromJson(json);
      expect(p.uid, 'p1');
      expect(p.amount, 200);
      expect(p.startsAt, isNull);
      expect(p.expiresAt, isNull);
    });

    test('Payment.fromJson parsea fechas válidas', () {
      final json = {
        'uid': 'p1',
        'driver': 'd1',
        'amount': 200,
        'durationDays': 30,
        'status': 'aprobado',
        'createdBy': 'admin',
        'startsAt': '2026-06-17T12:00:00.000Z',
        'expiresAt': '2026-07-17T12:00:00.000Z',
      };
      final p = Payment.fromJson(json);
      expect(p.startsAt, isNotNull);
      expect(p.expiresAt, isNotNull);
    });
  });

  group('Price model', () {
    test('Price.fromJson lee amount, durationDays, currency', () {
      final p = Price.fromJson({'amount': 200, 'durationDays': 30, 'currency': 'GTQ'});
      expect(p.amount, 200);
      expect(p.durationDays, 30);
      expect(p.currency, 'GTQ');
    });
  });

  group('PaymentStatus model', () {
    test('PaymentStatus.fromJson con activePayment null', () {
      final s = PaymentStatus.fromJson({
        'paid': false,
        'activePayment': null,
        'price': {'amount': 200, 'durationDays': 30, 'currency': 'GTQ'},
      });
      expect(s.paid, false);
      expect(s.activePayment, isNull);
      expect(s.price.amount, 200);
    });

    test('PaymentStatus.fromJson con activePayment presente', () {
      final s = PaymentStatus.fromJson({
        'paid': true,
        'activePayment': {
          'uid': 'p1', 'driver': 'd1',
          'amount': 200, 'durationDays': 30,
          'status': 'aprobado', 'createdBy': 'driver',
        },
        'price': {'amount': 200, 'durationDays': 30, 'currency': 'GTQ'},
      });
      expect(s.paid, true);
      expect(s.activePayment, isNotNull);
      expect(s.activePayment!.uid, 'p1');
    });
  });
}
```

- [ ] **Paso 3: Correr el test y confirmar que falla**

```bash
cd tukytuk
flutter test test/payment_service_test.dart
```

Esperado: falla con `Cannot find import 'package:tukytuk/models/payment.dart'`.

- [ ] **Paso 4: Crear `lib/models/payment.dart`**

```dart
import 'dart:convert';

DateTime? _tryParseDate(dynamic v) {
  if (v == null) return null;
  if (v is String) return DateTime.tryParse(v);
  return null;
}

class Price {
  final num amount;
  final int durationDays;
  final String currency;

  const Price({
    required this.amount,
    required this.durationDays,
    required this.currency,
  });

  factory Price.fromJson(Map<String, dynamic> json) => Price(
    amount: (json['amount'] as num?) ?? 0,
    durationDays: (json['durationDays'] as num?)?.toInt() ?? 0,
    currency: (json['currency'] as String?) ?? 'GTQ',
  );
}

class Payment {
  final String uid;
  final String driver;
  final num amount;
  final int durationDays;
  final String status;
  final String createdBy;
  final String? receiptUrl;
  final String? adminComment;
  final DateTime? startsAt;
  final DateTime? expiresAt;

  const Payment({
    required this.uid,
    required this.driver,
    required this.amount,
    required this.durationDays,
    required this.status,
    required this.createdBy,
    this.receiptUrl,
    this.adminComment,
    this.startsAt,
    this.expiresAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    uid: (json['uid'] as String?) ?? '',
    driver: (json['driver'] as String?) ?? '',
    amount: (json['amount'] as num?) ?? 0,
    durationDays: (json['durationDays'] as num?)?.toInt() ?? 0,
    status: (json['status'] as String?) ?? 'pendiente',
    createdBy: (json['createdBy'] as String?) ?? 'driver',
    receiptUrl: json['receiptUrl'] as String?,
    adminComment: json['adminComment'] as String?,
    startsAt: _tryParseDate(json['startsAt']),
    expiresAt: _tryParseDate(json['expiresAt']),
  );
}

class PaymentStatus {
  final bool paid;
  final Payment? activePayment;
  final Price price;

  const PaymentStatus({
    required this.paid,
    required this.price,
    this.activePayment,
  });

  factory PaymentStatus.fromJson(Map<String, dynamic> json) => PaymentStatus(
    paid: (json['paid'] as bool?) ?? false,
    activePayment: json['activePayment'] != null
      ? Payment.fromJson(Map<String, dynamic>.from(json['activePayment']))
      : null,
    price: Price.fromJson(Map<String, dynamic>.from(json['price'] ?? const {})),
  );
}
```

- [ ] **Paso 5: Crear `lib/services/payment_service.dart`**

```dart
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:tukytuk/const/general.dart';
import 'package:tukytuk/models/payment.dart';
import 'package:tukytuk/services/auth_service.dart';

class PaymentService {
  Future<PaymentStatus?> getStatus() async {
    try {
      final resp = await http.get(
        Uri.parse('${Constants.apiUrl}/payments/driver/status'),
        headers: {
          'Content-Type': 'application/json',
          'x-token': (await AuthService.getToken()) ?? ''
        },
      );
      if (resp.statusCode != 200) return null;
      final body = jsonDecode(resp.body);
      if (body['ok'] != true) return null;
      return PaymentStatus.fromJson(Map<String, dynamic>.from(body));
    } catch (e) {
      // ignore: avoid_print
      print('getStatus error: $e');
      return null;
    }
  }

  Future<List<Payment>> getList() async {
    try {
      final resp = await http.get(
        Uri.parse('${Constants.apiUrl}/payments/driver/list'),
        headers: {
          'Content-Type': 'application/json',
          'x-token': (await AuthService.getToken()) ?? ''
        },
      );
      if (resp.statusCode != 200) return [];
      final body = jsonDecode(resp.body);
      if (body['ok'] != true) return [];
      final list = (body['payments'] as List<dynamic>? ?? []);
      return list
        .map((j) => Payment.fromJson(Map<String, dynamic>.from(j as Map)))
        .toList();
    } catch (e) {
      // ignore: avoid_print
      print('getList error: $e');
      return [];
    }
  }

  Future<Payment?> uploadReceipt(File image) async {
    try {
      final token = (await AuthService.getToken()) ?? '';
      final uri = Uri.parse('${Constants.apiUrl}/payments/driver/upload');
      final req = http.MultipartRequest('POST', uri)
        ..headers['x-token'] = token
        ..files.add(await http.MultipartFile.fromPath('receipt', image.path));
      final streamed = await req.send();
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode != 200) return null;
      final body = jsonDecode(resp.body);
      if (body['ok'] != true) return null;
      return Payment.fromJson(Map<String, dynamic>.from(body['payment']));
    } catch (e) {
      // ignore: avoid_print
      print('uploadReceipt error: $e');
      return null;
    }
  }
}
```

- [ ] **Paso 6: Correr el test y confirmar que pasa**

```bash
cd tukytuk
flutter test test/payment_service_test.dart
```

Esperado: 5 tests pasan.

- [ ] **Paso 7: Analyze**

```bash
cd tukytuk
flutter analyze lib/models/payment.dart lib/services/payment_service.dart test/payment_service_test.dart
```

Esperado: cero warnings nuevos en estos archivos.

- [ ] **Paso 8: Commit**

```bash
cd tukytuk
git add lib/models/payment.dart lib/services/payment_service.dart test/payment_service_test.dart pubspec.yaml pubspec.lock
git commit -m "feat(flutter): PaymentService y modelos Payment/PaymentStatus/Price"
```

---

## Task 9: Flutter — PaymentDriverPage y socket listeners

**Files:**
- Create: `tukytuk/lib/pages/payment_driver_page.dart`
- Modify: `tukytuk/lib/services/socket_service.dart` (agregar streams `paymentApprovedStream`, `paymentRejectedStream`)
- Modify: `tukytuk/lib/routes/routes.dart` (registrar `'payment_driver'`)

**Interfaces:**
- Consumes: `PaymentService` (Tarea 8), `SocketService`.
- Produces:
  - `SocketService.paymentApprovedStream: Stream<Map<String, dynamic>>`.
  - `SocketService.paymentRejectedStream: Stream<Map<String, dynamic>>`.
  - `PaymentDriverPage` con dos secciones: estado actual (al día o vencido + precio) y lista de historial. Botón "Subir comprobante" abre `image_picker`. Refresca al recibir `payment-approved` y muestra dialog con comentario al recibir `payment-rejected`.

- [ ] **Paso 1: Agregar streams al SocketService**

Editar `tukytuk/lib/services/socket_service.dart`. Junto a los otros StreamControllers, agregar:

```dart
final _paymentApprovedCtrl = StreamController<Map<String, dynamic>>.broadcast();
final _paymentRejectedCtrl = StreamController<Map<String, dynamic>>.broadcast();

Stream<Map<String, dynamic>> get paymentApprovedStream => _paymentApprovedCtrl.stream;
Stream<Map<String, dynamic>> get paymentRejectedStream => _paymentRejectedCtrl.stream;
```

Dentro del setup de `connect()` (junto a los otros `_socket.on(...)`):

```dart
_socket.on('payment-approved', (data) {
  if (data is Map) _paymentApprovedCtrl.add(Map<String, dynamic>.from(data));
});

_socket.on('payment-rejected', (data) {
  if (data is Map) _paymentRejectedCtrl.add(Map<String, dynamic>.from(data));
});
```

En `dispose()`, cerrar los dos nuevos controllers:

```dart
_paymentApprovedCtrl.close();
_paymentRejectedCtrl.close();
```

- [ ] **Paso 2: Crear `lib/pages/payment_driver_page.dart`**

```dart
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:tukytuk/models/payment.dart';
import 'package:tukytuk/services/payment_service.dart';
import 'package:tukytuk/services/socket_service.dart';

class PaymentDriverPage extends StatefulWidget {
  const PaymentDriverPage({super.key});

  @override
  State<PaymentDriverPage> createState() => _PaymentDriverPageState();
}

class _PaymentDriverPageState extends State<PaymentDriverPage> {
  PaymentStatus? _status;
  List<Payment> _history = [];
  bool _loading = true;
  StreamSubscription? _approvedSub;
  StreamSubscription? _rejectedSub;

  @override
  void initState() {
    super.initState();
    _load();
    final socket = context.read<SocketService>();
    _approvedSub = socket.paymentApprovedStream.listen((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tu pago fue aprobado'), backgroundColor: Colors.green),
      );
      _load();
    });
    _rejectedSub = socket.paymentRejectedStream.listen((data) {
      if (!mounted) return;
      final comment = (data['payment'] is Map)
        ? (data['payment']['adminComment'] ?? '')
        : '';
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Pago rechazado'),
          content: Text('Motivo: $comment'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cerrar'),
            ),
            ElevatedButton(
              onPressed: () { Navigator.pop(ctx); _pickAndUpload(); },
              child: const Text('Subir otro comprobante'),
            ),
          ],
        ),
      );
      _load();
    });
  }

  @override
  void dispose() {
    _approvedSub?.cancel();
    _rejectedSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final svc = PaymentService();
    final status = await svc.getStatus();
    final list = await svc.getList();
    if (!mounted) return;
    setState(() {
      _status = status;
      _history = list;
      _loading = false;
    });
  }

  Future<void> _pickAndUpload() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    final svc = PaymentService();
    final created = await svc.uploadReceipt(File(picked.path));
    if (!mounted) return;
    if (created != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Comprobante enviado, esperando aprobación')),
      );
      _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo enviar el comprobante')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mi mensualidad')),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _StatusCard(status: _status, onUpload: _pickAndUpload),
                const SizedBox(height: 16),
                const Text('Historial', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                if (_history.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: Text('Sin pagos aún')),
                  ),
                ..._history.map((p) => _HistoryTile(payment: p)),
              ],
            ),
          ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final PaymentStatus? status;
  final VoidCallback onUpload;
  const _StatusCard({required this.status, required this.onUpload});

  @override
  Widget build(BuildContext context) {
    final paid = status?.paid ?? false;
    final price = status?.price;
    final color = paid ? Colors.green : Colors.red;
    final label = paid
      ? 'Estás al día'
      : 'Mensualidad vencida';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 8),
            if (price != null)
              Text('Monto: ${price.currency} ${price.amount} por ${price.durationDays} días'),
            if (paid && status?.activePayment?.expiresAt != null)
              Text('Vigente hasta: ${status!.activePayment!.expiresAt!.toLocal().toString().split(' ').first}'),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: onUpload,
                icon: const Icon(Icons.upload),
                label: const Text('Subir comprobante de pago'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  final Payment payment;
  const _HistoryTile({required this.payment});

  Color get _statusColor {
    switch (payment.status) {
      case 'aprobado': return Colors.green;
      case 'rechazado': return Colors.red;
      default: return Colors.orange;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(backgroundColor: _statusColor, child: Text(payment.status[0].toUpperCase())),
      title: Text('${payment.amount} por ${payment.durationDays} días'),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Estado: ${payment.status}'),
          if (payment.adminComment != null && payment.adminComment!.isNotEmpty)
            Text('Comentario admin: ${payment.adminComment}'),
        ],
      ),
    );
  }
}
```

- [ ] **Paso 3: Registrar la ruta `'payment_driver'`**

Editar `tukytuk/lib/routes/routes.dart`. Importar el page y agregar al mapa `appRoutes`:

```dart
import 'package:tukytuk/pages/payment_driver_page.dart';
// ...
'payment_driver': (_) => const PaymentDriverPage(),
```

- [ ] **Paso 4: Analyze**

```bash
cd tukytuk
flutter analyze lib/pages/payment_driver_page.dart lib/services/socket_service.dart lib/routes/routes.dart
```

Esperado: sin warnings nuevos en estos archivos.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk
git add lib/pages/payment_driver_page.dart lib/services/socket_service.dart lib/routes/routes.dart
git commit -m "feat(flutter): PaymentDriverPage con subida de comprobante y listeners socket"
```

---

## Task 10: Flutter — Gate al ponerse online (modal bloqueante)

**Files:**
- Create: `tukytuk/lib/widgets/payment_gate_dialog.dart`
- Modify: `tukytuk/lib/services/auth_service.dart` (si está la lógica de toggle online ahí) o el archivo donde el conductor cambia `online`. El implementer descubre cuál es.

**Interfaces:**
- Consumes: `PaymentService.getStatus()`, navigate `'payment_driver'`.
- Produces: helper `Future<bool> ensureDriverPaidOrShowGate(BuildContext, {required Future<PaymentStatus?> Function() getStatus, required VoidCallback onGoToPayment})`. Devuelve `true` si está al día y se puede continuar; `false` si se mostró el modal y el usuario no debe pasar a online.

- [ ] **Paso 1: Crear el widget helper**

Crear `tukytuk/lib/widgets/payment_gate_dialog.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:tukytuk/models/payment.dart';
import 'package:tukytuk/services/payment_service.dart';

class PaymentGateDialog {
  /// Verifica si el conductor está al día y, si no, muestra modal bloqueante.
  /// Devuelve true si está al día (se puede continuar), false si se mostró el modal.
  static Future<bool> check(BuildContext context) async {
    final svc = PaymentService();
    final status = await svc.getStatus();
    if (status == null) {
      // No se pudo verificar — mejor bloquear con mensaje genérico
      await _show(context, null);
      return false;
    }
    if (status.paid) return true;
    await _show(context, status.price);
    return false;
  }

  static Future<void> _show(BuildContext context, Price? price) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Mensualidad vencida'),
        content: Text(price != null
          ? 'Para recibir viajes, sube tu comprobante de pago. Monto: ${price.currency} ${price.amount} por ${price.durationDays} días.'
          : 'Para recibir viajes, sube tu comprobante de pago.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Más tarde'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              Navigator.pushNamed(ctx, 'payment_driver');
            },
            child: const Text('Subir comprobante'),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Paso 2: Conectar el gate al toggle de "ponerse online" del conductor**

El implementer debe localizar dónde el conductor pone su switch `online` a `true`. Candidatos por orden de probabilidad:
- `tukytuk/lib/pages/trip_driver_page.dart` — el Switch en el AppBar (`onChanged: toggleSwitch`).
- `tukytuk/lib/pages/home_page.dart` o similar.

**Buscarlo:**
```bash
grep -rn "Switch\|online" /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk/lib --include="*.dart" | grep -i "switch\|online" | head -20
```

Una vez localizado, envolver la llamada del cambio `online: true` con:

```dart
final canGoOnline = await PaymentGateDialog.check(context);
if (!canGoOnline) {
  // No actualizar el estado del Switch, dejarlo en false
  setState(() { isSelected = false; });
  return;
}
// Continuar con la lógica original
```

(Adaptar `setState` y nombre del field según el archivo.)

Adicionalmente, si la app llama al backend `PUT /api/usuarios/online` y recibe 402, propagar para mostrar el modal incluso si no se hizo el chequeo previo. Esto es defensa-en-profundidad.

- [ ] **Paso 3: Analyze**

```bash
cd tukytuk
flutter analyze lib/widgets/payment_gate_dialog.dart
```

Esperado: sin warnings nuevos.

- [ ] **Paso 4: Smoke manual (opcional)**

Si tienes la app corriendo, intenta poner el Switch online sin pago al día → debe aparecer el modal "Mensualidad vencida".

- [ ] **Paso 5: Commit**

```bash
cd tukytuk
git add lib/widgets/payment_gate_dialog.dart <archivo-con-toggle>
git commit -m "feat(flutter): gate del Switch online que bloquea sin pago vigente"
```

---

## Task 11: Admin — API client de pagos y componente AuthImage

**Files:**
- Create: `tukytuk-admin/src/api/payments.ts`
- Create: `tukytuk-admin/src/components/AuthImage.tsx`

**Interfaces:**
- Consumes: cliente axios existente (revisar `tukytuk-admin/src/api/` para el patrón — probablemente hay un `httpClient.ts` o `apiClient`). Si no existe, usar axios directo con el token de localStorage.
- Produces:
  - `Payment`, `PaymentSettings` TS interfaces.
  - Funciones: `listPayments(filters)`, `approvePayment(id)`, `rejectPayment(id, adminComment)`, `createManualPayment(formData)`, `getSettings()`, `updateSettings(data)`, `setSpecialPricing(driverUid, data)`.
  - `<AuthImage src receiptUrl alt />` component que fetcha la imagen con `x-token`, crea `Blob URL`, lo renderiza y lo revoca al desmontar.

- [ ] **Paso 1: Identificar patrón axios en el admin**

```bash
cd tukytuk-admin
ls src/api/
cat src/api/drivers.ts  # existente, usar como referencia
```

Anotar: nombre del cliente axios, cómo se obtiene el token (probablemente `localStorage.getItem('tukytuk_token')`).

- [ ] **Paso 2: Crear `src/api/payments.ts`**

```ts
import axios from 'axios';

const apiUrl = import.meta.env.VITE_API_URL || 'http://52.87.214.235/api';

const auth = () => ({ headers: { 'x-token': localStorage.getItem('tukytuk_token') ?? '' } });

export interface Payment {
  uid: string;
  driver: string;
  amount: number;
  durationDays: number;
  status: 'pendiente' | 'aprobado' | 'rechazado';
  createdBy: 'driver' | 'admin';
  receiptUrl?: string;
  adminComment?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  startsAt?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentSettings {
  driverMonthlyPrice: number;
  driverMonthlyDurationDays: number;
  currency: string;
}

export interface PaymentListResult {
  payments: Payment[];
  total: number;
  page: number;
  limit: number;
}

export interface PaymentListFilters {
  status?: 'pendiente' | 'aprobado' | 'rechazado';
  driverUid?: string;
  page?: number;
  limit?: number;
}

export async function listPayments(filters: PaymentListFilters = {}): Promise<PaymentListResult> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.driverUid) params.set('driverUid', filters.driverUid);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const url = `${apiUrl}/payments/admin/list${params.toString() ? '?' + params.toString() : ''}`;
  const res = await axios.get(url, auth());
  return { payments: res.data.payments, total: res.data.total, page: res.data.page, limit: res.data.limit };
}

export async function approvePayment(id: string): Promise<Payment> {
  const res = await axios.put(`${apiUrl}/payments/admin/${id}/approve`, {}, auth());
  return res.data.payment;
}

export async function rejectPayment(id: string, adminComment: string): Promise<Payment> {
  const res = await axios.put(`${apiUrl}/payments/admin/${id}/reject`, { adminComment }, auth());
  return res.data.payment;
}

export async function createManualPayment(form: FormData): Promise<Payment> {
  const res = await axios.post(`${apiUrl}/payments/admin/create`, form, {
    headers: { ...auth().headers, 'Content-Type': 'multipart/form-data' }
  });
  return res.data.payment;
}

export async function getSettings(): Promise<PaymentSettings> {
  const res = await axios.get(`${apiUrl}/payments/admin/settings`, auth());
  return res.data.settings;
}

export async function updateSettings(data: Partial<PaymentSettings>): Promise<PaymentSettings> {
  const res = await axios.put(`${apiUrl}/payments/admin/settings`, data, auth());
  return res.data.settings;
}

export async function setSpecialPricing(
  driverUid: string,
  data: { specialPrice: number | null; specialDurationDays: number | null }
) {
  const res = await axios.put(`${apiUrl}/usuarios/admin/${driverUid}/special-pricing`, data, auth());
  return res.data.driver;
}
```

Ajustar `import.meta.env.VITE_API_URL` si el repo tiene otra fuente de la URL base (revisar `src/api/drivers.ts` para alineación).

- [ ] **Paso 3: Crear `src/components/AuthImage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Box, CircularProgress, Typography } from '@mui/material';

const apiUrl = import.meta.env.VITE_API_URL || 'http://52.87.214.235/api';

interface AuthImageProps {
  receiptUrl: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
}

export function AuthImage({ receiptUrl, alt, width, height, style }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(false);
    const filename = receiptUrl.split('/').pop() ?? '';
    axios
      .get(`${apiUrl}/payments/receipt/${filename}`, {
        responseType: 'blob',
        headers: { 'x-token': localStorage.getItem('tukytuk_token') ?? '' }
      })
      .then((res) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => { if (!revoked) { setError(true); setLoading(false); } });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [receiptUrl]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width, height }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error || !src) {
    return <Typography color="error" variant="caption">No disponible</Typography>;
  }
  return <img src={src} alt={alt ?? 'comprobante'} width={width} height={height} style={style} />;
}
```

- [ ] **Paso 4: Build / lint**

```bash
cd tukytuk-admin
npm run lint
```

Esperado: cero errores (`--max-warnings 0` está configurado).

- [ ] **Paso 5: Commit**

```bash
cd tukytuk-admin
git add src/api/payments.ts src/components/AuthImage.tsx
git commit -m "feat(admin): api client de pagos y componente AuthImage"
```

---

## Task 12: Admin — PaymentsListPage (lista con aprobar/rechazar)

**Files:**
- Create: `tukytuk-admin/src/admin/payments/PaymentsListPage.tsx`
- Modify: `tukytuk-admin/src/router/AppRouter.jsx` (registrar `/pagos`)
- Modify: sidebar/nav (agregar entrada "Pagos")

**Interfaces:**
- Consumes: `listPayments`, `approvePayment`, `rejectPayment` (Tarea 11), `<AuthImage>` (Tarea 11).
- Produces: página con tabla MUI mostrando pagos, filtros por status y driverUid, botones aprobar/rechazar para los pendientes, modal de detalle con `<AuthImage>`.

- [ ] **Paso 1: Crear `src/admin/payments/PaymentsListPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  Box, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Stack, Typography, CircularProgress
} from '@mui/material';
import {
  listPayments, approvePayment, rejectPayment, Payment, PaymentListFilters
} from '../../api/payments';
import { AuthImage } from '../../components/AuthImage';

export default function PaymentsListPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<PaymentListFilters>({ status: 'pendiente', page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Payment | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listPayments(filters);
      setPayments(r.payments);
      setTotal(r.total);
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo cargar la lista');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters.status, filters.page]);

  const onApprove = async (p: Payment) => {
    try { await approvePayment(p.uid); await load(); }
    catch (e: any) { setError(e?.message ?? 'No se pudo aprobar'); }
  };

  const onConfirmReject = async () => {
    if (!rejectTarget) return;
    if (rejectComment.trim().length < 3) return;
    try {
      await rejectPayment(rejectTarget.uid, rejectComment.trim());
      setRejectTarget(null);
      setRejectComment('');
      await load();
    } catch (e: any) { setError(e?.message ?? 'No se pudo rechazar'); }
  };

  const statusColor = (s: string) =>
    s === 'aprobado' ? 'success' : s === 'rechazado' ? 'error' : 'warning';

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Pagos</Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          select label="Estado" size="small" sx={{ minWidth: 160 }}
          value={filters.status ?? ''}
          onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as any, page: 1 })}
        >
          <MenuItem value="">Todos</MenuItem>
          <MenuItem value="pendiente">Pendientes</MenuItem>
          <MenuItem value="aprobado">Aprobados</MenuItem>
          <MenuItem value="rechazado">Rechazados</MenuItem>
        </TextField>
        <TextField
          label="Conductor (uid)" size="small" sx={{ minWidth: 240 }}
          value={filters.driverUid ?? ''}
          onChange={(e) => setFilters({ ...filters, driverUid: e.target.value || undefined, page: 1 })}
          onBlur={() => load()}
        />
        <Button variant="outlined" onClick={load}>Refrescar</Button>
      </Stack>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Fecha</TableCell>
              <TableCell>Conductor</TableCell>
              <TableCell>Monto</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Comprobante</TableCell>
              <TableCell>Comentario</TableCell>
              <TableCell>Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.uid}>
                <TableCell>{p.createdAt?.split('T')[0]}</TableCell>
                <TableCell>{p.driver}</TableCell>
                <TableCell>{p.amount} ({p.durationDays}d)</TableCell>
                <TableCell><Chip label={p.status} color={statusColor(p.status)} size="small" /></TableCell>
                <TableCell>
                  {p.receiptUrl ? (
                    <Button size="small" onClick={() => setPreviewUrl(p.receiptUrl!)}>Ver</Button>
                  ) : <Typography variant="caption">—</Typography>}
                </TableCell>
                <TableCell>{p.adminComment ?? '—'}</TableCell>
                <TableCell>
                  {p.status === 'pendiente' && (
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" color="success" onClick={() => onApprove(p)}>Aprobar</Button>
                      <Button size="small" variant="contained" color="error" onClick={() => setRejectTarget(p)}>Rechazar</Button>
                    </Stack>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {payments.length === 0 && (
              <TableRow><TableCell colSpan={7}><Typography align="center" sx={{ py: 3 }}>Sin resultados</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Typography variant="caption" sx={{ mt: 2, display: 'block' }}>
        Total: {total}
      </Typography>

      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)}>
        <DialogTitle>Rechazar pago</DialogTitle>
        <DialogContent>
          <TextField
            label="Motivo (mínimo 3 caracteres)" fullWidth multiline minRows={2} sx={{ mt: 1, minWidth: 360 }}
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>Cancelar</Button>
          <Button
            variant="contained" color="error"
            disabled={rejectComment.trim().length < 3}
            onClick={onConfirmReject}
          >Rechazar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!previewUrl} onClose={() => setPreviewUrl(null)} maxWidth="md">
        <DialogTitle>Comprobante</DialogTitle>
        <DialogContent>
          {previewUrl && <AuthImage receiptUrl={previewUrl} style={{ maxWidth: '100%', maxHeight: '70vh' }} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewUrl(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
```

- [ ] **Paso 2: Registrar la ruta `/pagos` en `AppRouter.jsx`**

Editar `tukytuk-admin/src/router/AppRouter.jsx`. Importar el componente y agregar la ruta en el `<Routes>` dentro de `JournalRoutes` (el router admin actual, que está en `<Route path="/*" element={<JournalRoutes />} />`).

Si `JournalRoutes` es un componente que define sus propias rutas, edita ese archivo (probablemente `src/admin/JournalRoutes.tsx` o `.jsx`). Agregar:

```jsx
import PaymentsListPage from './payments/PaymentsListPage';
// ...
<Route path="/pagos" element={<PaymentsListPage />} />
```

- [ ] **Paso 3: Agregar entrada "Pagos" al sidebar**

Encontrar la navegación lateral del `AdminLayout` (probablemente `src/admin/layouts/AdminLayout.tsx` o similar). Agregar un item `{ label: 'Pagos', path: '/pagos', icon: <PaymentsIcon /> }` (usar el icono MUI que el resto use).

- [ ] **Paso 4: Build / lint**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: lint sin errores, build exitoso.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/PaymentsListPage.tsx src/router/AppRouter.jsx <archivos navegación tocados>
git commit -m "feat(admin): PaymentsListPage con aprobar/rechazar y preview de comprobante"
```

---

## Task 13: Admin — CreateManualPaymentPage y PaymentSettingsPage

**Files:**
- Create: `tukytuk-admin/src/admin/payments/CreateManualPaymentPage.tsx`
- Create: `tukytuk-admin/src/admin/payments/PaymentSettingsPage.tsx`
- Modify: router para rutas `/pagos/nuevo` y `/pagos/configuracion`.
- Modify: navegación / sub-items del item "Pagos".

**Interfaces:**
- Consumes: `createManualPayment`, `getSettings`, `updateSettings` (Tarea 11).
- Produces: dos páginas funcionales.

- [ ] **Paso 1: Crear `CreateManualPaymentPage.tsx`**

```tsx
import { useState } from 'react';
import { Box, Typography, TextField, Button, Stack, Alert } from '@mui/material';
import { createManualPayment } from '../../api/payments';

export default function CreateManualPaymentPage() {
  const [driverUid, setDriverUid] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [amount, setAmount] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverUid.trim() || adminComment.trim().length < 3) {
      setMsg({ kind: 'err', text: 'Conductor y comentario (≥3 caracteres) son obligatorios' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('driverUid', driverUid.trim());
      form.append('adminComment', adminComment.trim());
      if (amount) form.append('amount', amount);
      if (durationDays) form.append('durationDays', durationDays);
      if (receipt) form.append('receipt', receipt);
      await createManualPayment(form);
      setMsg({ kind: 'ok', text: 'Pago creado correctamente' });
      setDriverUid(''); setAdminComment(''); setAmount(''); setDurationDays(''); setReceipt(null);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.response?.data?.msg ?? err?.message ?? 'Error al crear' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 600 }}>
      <Typography variant="h4" gutterBottom>Nuevo pago manual</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Para conductores existentes y casos especiales. El comprobante es opcional pero el comentario es obligatorio.
      </Typography>
      <form onSubmit={submit}>
        <Stack spacing={2}>
          <TextField
            label="Conductor (uid)" required fullWidth
            value={driverUid} onChange={(e) => setDriverUid(e.target.value)}
          />
          <TextField
            label="Comentario admin (mínimo 3 caracteres)" required fullWidth multiline minRows={2}
            value={adminComment} onChange={(e) => setAdminComment(e.target.value)}
          />
          <TextField
            label="Monto (vacío = usar valor por defecto)" type="number" fullWidth
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label="Duración en días (vacío = usar valor por defecto)" type="number" fullWidth
            value={durationDays} onChange={(e) => setDurationDays(e.target.value)}
          />
          <Button variant="outlined" component="label">
            {receipt ? `Comprobante: ${receipt.name}` : 'Adjuntar comprobante (opcional)'}
            <input
              type="file" hidden accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
          </Button>
          {msg && <Alert severity={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</Alert>}
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Creando...' : 'Crear pago'}
          </Button>
        </Stack>
      </form>
    </Box>
  );
}
```

- [ ] **Paso 2: Crear `PaymentSettingsPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Stack, Alert, CircularProgress } from '@mui/material';
import { getSettings, updateSettings, PaymentSettings } from '../../api/payments';

export default function PaymentSettingsPage() {
  const [data, setData] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    getSettings().then((s) => { setData(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!data) return;
    setBusy(true); setMsg(null);
    try {
      const updated = await updateSettings({
        driverMonthlyPrice: Number(data.driverMonthlyPrice),
        driverMonthlyDurationDays: Number(data.driverMonthlyDurationDays),
        currency: data.currency
      });
      setData(updated);
      setMsg({ kind: 'ok', text: 'Guardado' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'No se pudo guardar' });
    } finally { setBusy(false); }
  };

  if (loading) return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (!data) return <Box sx={{ p: 3 }}><Alert severity="error">No se pudo cargar la configuración</Alert></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 500 }}>
      <Typography variant="h4" gutterBottom>Configuración de pagos</Typography>
      <Stack spacing={2}>
        <TextField
          label="Precio mensual base" type="number" fullWidth
          value={data.driverMonthlyPrice}
          onChange={(e) => setData({ ...data, driverMonthlyPrice: Number(e.target.value) })}
        />
        <TextField
          label="Duración base (días)" type="number" fullWidth
          value={data.driverMonthlyDurationDays}
          onChange={(e) => setData({ ...data, driverMonthlyDurationDays: Number(e.target.value) })}
        />
        <TextField
          label="Moneda" fullWidth
          value={data.currency}
          onChange={(e) => setData({ ...data, currency: e.target.value })}
        />
        {msg && <Alert severity={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</Alert>}
        <Button variant="contained" onClick={save} disabled={busy}>
          {busy ? 'Guardando...' : 'Guardar'}
        </Button>
      </Stack>
    </Box>
  );
}
```

- [ ] **Paso 3: Registrar las dos rutas**

En el archivo de rutas del admin (donde agregaste `/pagos` en la Tarea 12):

```jsx
import CreateManualPaymentPage from './payments/CreateManualPaymentPage';
import PaymentSettingsPage from './payments/PaymentSettingsPage';
// ...
<Route path="/pagos/nuevo" element={<CreateManualPaymentPage />} />
<Route path="/pagos/configuracion" element={<PaymentSettingsPage />} />
```

- [ ] **Paso 4: Agregar entradas de submenú o botones de navegación**

Decidir si "Pagos" es un menú con sub-items o un solo item. Si es submenú, agregar "Nuevo pago" y "Configuración" como hijos. Alternativa simple: en `PaymentsListPage` agregar dos botones en el header `<Button onClick={() => navigate('/pagos/nuevo')}>Nuevo</Button>` y `<Button onClick={() => navigate('/pagos/configuracion')}>Configuración</Button>`. Es más rápido si la barra lateral no soporta sub-items.

- [ ] **Paso 5: Build / lint**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero errores.

- [ ] **Paso 6: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/CreateManualPaymentPage.tsx src/admin/payments/PaymentSettingsPage.tsx <archivos router/nav>
git commit -m "feat(admin): paginas crear pago manual y configurar precios"
```

---

## Task 14: Admin — Sección de precio especial por conductor (opcional)

**Files:**
- Modify: la pantalla de detalle de conductor en `tukytuk-admin/`. Si no existe, crear `tukytuk-admin/src/admin/drivers/SpecialPricingDialog.tsx` y exponerla como botón desde la lista de conductores.

**Interfaces:**
- Consumes: `setSpecialPricing(driverUid, data)` (Tarea 11).
- Produces: una UI para fijar / borrar `specialPrice` y `specialDurationDays` por conductor.

- [ ] **Paso 1: Decidir el punto de entrada**

```bash
cd tukytuk-admin
grep -rn "drivers\|Driver" src/admin --include="*.tsx" -l | head -10
```

Si existe `DriverDetailPage.tsx`, agregar la sección dentro. Si solo hay `CreateDriverPage` y un listado, mejor crear un dialog y abrirlo desde el botón "..." de cada fila de la lista de conductores.

- [ ] **Paso 2: Crear `SpecialPricingDialog.tsx`**

```tsx
import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Stack, Alert } from '@mui/material';
import { setSpecialPricing } from '../../api/payments';

interface Props {
  open: boolean;
  driverUid: string;
  initialPrice?: number;
  initialDurationDays?: number;
  onClose: () => void;
  onSaved: () => void;
}

export function SpecialPricingDialog({ open, driverUid, initialPrice, initialDurationDays, onClose, onSaved }: Props) {
  const [price, setPrice] = useState<string>(initialPrice != null ? String(initialPrice) : '');
  const [duration, setDuration] = useState<string>(initialDurationDays != null ? String(initialDurationDays) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await setSpecialPricing(driverUid, {
        specialPrice: price ? Number(price) : null,
        specialDurationDays: duration ? Number(duration) : null,
      });
      onSaved();
      onClose();
    } catch (e: any) { setErr(e?.message ?? 'Error al guardar'); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setErr(null);
    try {
      await setSpecialPricing(driverUid, { specialPrice: null, specialDurationDays: null });
      onSaved();
      onClose();
    } catch (e: any) { setErr(e?.message ?? 'Error al borrar'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Precio especial</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1, minWidth: 320 }}>
          <TextField label="Precio especial" type="number" fullWidth value={price} onChange={(e) => setPrice(e.target.value)} />
          <TextField label="Duración (días)" type="number" fullWidth value={duration} onChange={(e) => setDuration(e.target.value)} />
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={clear} color="warning" disabled={busy}>Quitar precio especial</Button>
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={save} variant="contained" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Paso 3: Cablear el dialog desde la lista/detalle de conductores**

Encontrar el componente que renderiza la lista o detalle de un conductor (`src/admin/drivers/...`). Agregar un botón "Precio especial" que abra el `SpecialPricingDialog` con el `driverUid` actual.

Si no hay un buen punto de entrada y crear uno excede el alcance, marca este paso como TODO y registralo como follow-up en el reporte final — esta tarea es la única opcional del plan.

- [ ] **Paso 4: Build / lint**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero errores.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk-admin
git add src/admin/drivers/SpecialPricingDialog.tsx <archivos donde se cableó>
git commit -m "feat(admin): dialog para fijar/borrar precio especial por conductor"
```

---

## Notas finales

- **Tests Flutter limitados:** sólo el modelo + servicio (Tarea 8). Las pantallas no llevan widget test exhaustivo por costo; se verifican manualmente.
- **Test admin no hay:** el admin del proyecto no tiene framework de tests configurado en pipeline; se verifica con `npm run lint --max-warnings 0` + `npm run build`.
- **Verificación manual del golden path** (post-implementación): el flujo del spec sección 9 (admin configura precio base → conductor intenta online sin pago → modal bloqueante → conductor sube comprobante → admin aprueba → conductor recibe SnackBar y puede ponerse online → admin crea pago manual con comentario → admin define precio especial → conductor con vigencia activa renueva y acumula días).
- **Bugs preexistentes NO tocados** (mismo principio que Spec 1): cualquier issue fuera del alcance se anota como follow-up.
- **Despliegue:** backend a `52.87.214.235` (crear `uploads/payments/` con permisos del proceso Node antes del deploy). Admin: `npm run build` y servir bundle. Flutter: build APK con `MAPBOX_TOKEN` ya configurado del Spec 1.
