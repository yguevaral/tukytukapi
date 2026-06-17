# Mejoras admin pagos — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** Mejorar el admin web de pagos: ocultar ObjectIds, unificar alertas con `useToast()`, arreglar el botón de subir comprobante roto, agregar página de detalle de pago con historial editable, y permitir marcar pagos vencidos (individual + masivo) con desactivación del conductor.

**Architecture:** Backend agrega `Payment.events: []` (append-only) y estado `'vencido'`. Cinco endpoints nuevos: detalle, PATCH (editar comentario / reemplazar comprobante), expire individual, expire masivo, y un cambio al listado para hacer `$lookup` a Usuario+Driver y devolver `driverNombre`/`driverPlate`. Admin gana `<ToastProvider>` + `useToast()`, una nueva `PaymentDetailPage` con `<EventTimeline>`, y mejoras puntuales en pantallas existentes.

**Tech Stack:**
- Backend: Node.js + Express + Mongoose + multer. Tests `node:test` + `node:assert/strict`.
- Admin: React 18 + TS + Vite + MUI + axios (vía `apiClient`).

## Global Constraints

- Idioma: comentarios y commits en español. Strings de UI en español.
- Convenciones backend: respuestas `{ ok: boolean, msg: string, ... }`. Tests con `node:test`. Conventional commits en español. Sin Co-author. Sin `--no-verify`. `git add` por nombre.
- `Payment.status` enum nuevo: `['pendiente', 'aprobado', 'rechazado', 'vencido']`.
- `Payment.events` items: `{ type: string, at: Date, by?: string, reason?: string }`. `by` es uid del admin/conductor o `'system'`. Append-only.
- `PATCH /admin/:id` válido solo cuando `status === 'pendiente' || status === 'rechazado'` (409 en otros).
- `POST /admin/:id/expire` solo cuando `status === 'aprobado'` (409 en otros).
- Upload existente para pagos: `helpers/upload.js` (mismo de Spec 2). Mismos límites: 5MB, jpeg/png/webp.
- Convención admin: TypeScript estricto, `apiClient.get/put/patch/post<T>` con genéricos, sin `any` implícito. `npm run lint --max-warnings 0` y `npm run build` deben pasar.
- Toast: única vía para mostrar feedback de acciones (crear/editar/guardar/eliminar). `useToast()` solo se llama dentro del `<ToastProvider>`.

---

## Estructura de archivos a tocar

**Backend (`tukytukapi/`):**
- Modify: `models/payment.js` (enum + `events`).
- Modify: `controllers/payments.js` (refactor `adminListPayments` a aggregate; agregar `adminGetPaymentDetail`, `adminPatchPayment`, `adminExpirePayment`, `adminExpireOverdue`; agregar eventos a handlers existentes).
- Modify: `routes/payments.js` (rutas nuevas + middleware multer-error para PATCH).
- Create: `tests/payments-events.test.js`.
- Create: `tests/payments-list-lookup.test.js`.
- Create: `tests/payments-detail.test.js`.
- Create: `tests/payments-patch.test.js`.
- Create: `tests/payments-expire-individual.test.js`.
- Create: `tests/payments-expire-overdue.test.js`.

**Admin (`tukytuk-admin/`):**
- Create: `src/components/toast/ToastProvider.tsx`.
- Create: `src/components/toast/useToast.ts`.
- Modify: `src/journal/routes/JournalRoutes.jsx` (envolver con `<ToastProvider>`, agregar ruta `/admin/pagos/:id`).
- Modify: `src/admin/payments/PaymentsListPage.tsx` (mostrar nombre+placa, filtro Vencido, botones "Ver" y "Marcar vencidos", `useToast`).
- Modify: `src/admin/payments/CreateManualPaymentPage.tsx` (fix upload + `useToast`).
- Modify: `src/admin/payments/PaymentSettingsPage.tsx` (`useToast`).
- Modify: `src/admin/payments/SpecialPricingPage.tsx` (`useToast`).
- Modify: `src/admin/payments/SpecialPricingDialog.tsx` (prop `driverLabel`, `useToast`).
- Modify: `src/admin/drivers/DriverDetailPage.tsx` (`useToast` + pasar `driverLabel` al dialog).
- Modify: `src/admin/drivers/DriversListPage.tsx` (`useToast`).
- Modify: `src/components/DriverImagePicker.tsx` (`useToast`).
- Modify: `src/api/payments.ts` (tipos + `getPayment`, `patchPayment`, `expirePayment`, `expireOverduePayments`).
- Create: `src/admin/payments/PaymentDetailPage.tsx`.
- Create: `src/admin/payments/EventTimeline.tsx`.

---

## Task 1: Modelo Payment — estado 'vencido' y events

**Files:**
- Modify: `tukytukapi/models/payment.js`
- Test: `tukytukapi/tests/payments-events.test.js` (crear placeholder; se llena en T2)

**Interfaces:**
- Produces: `Payment.status` enum gana `'vencido'`. Nuevo campo `events: [{ type, at, by?, reason? }]` con `default: []`. Tareas 2-7 lo consumen.

- [ ] **Paso 1: Editar `models/payment.js`**

Reemplazar el campo `status` y agregar `events`:

```js
status: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado', 'vencido'],
    default: 'pendiente',
    index: true
},
```

Al final del schema (antes del cierre `}` que precede a `{ timestamps: true }`):

```js
events: {
    type: [{
        type: { type: String, required: true },
        at: { type: Date, required: true, default: () => new Date() },
        by: { type: String },
        reason: { type: String }
    }],
    default: []
},
```

- [ ] **Paso 2: Crear test stub que valida el enum y events**

Crear `tukytukapi/tests/payments-events.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Payment = require('../models/payment');

test('Payment status acepta vencido', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        status: 'vencido'
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
});

test('Payment events está vacío por defecto', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg'
    });
    assert.deepEqual(p.events.toObject(), []);
});

test('Payment acepta events con type, at, by y reason', () => {
    const p = new Payment({
        driver: '507f1f77bcf86cd799439011',
        amount: 200, durationDays: 30,
        createdBy: 'driver',
        receiptUrl: '/api/payments/receipt/x.jpg',
        events: [{ type: 'aprobado', at: new Date(), by: 'admin1' }]
    });
    const err = p.validateSync();
    assert.equal(err, undefined);
    assert.equal(p.events[0].type, 'aprobado');
});
```

- [ ] **Paso 3: Correr los tests**

```bash
cd tukytukapi
node --test tests/payments-events.test.js
```

Esperado: 3 tests pasan.

- [ ] **Paso 4: Suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add models/payment.js tests/payments-events.test.js
git commit -m "feat(backend): Payment soporta estado vencido y array events append-only"
```

---

## Task 2: Helper appendEvent + eventos en handlers existentes

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (helper `appendEvent`; agregar eventos a `uploadDriverPayment`, `adminCreatePayment`, `adminApprovePayment`, `adminRejectPayment`)
- Modify: `tukytukapi/tests/payments-events.test.js` (agregar tests)

**Interfaces:**
- Produces: helper interno `appendEvent(payment, type, by, reason?)` que mutará el documento sin guardarlo. Garantiza que el array existe antes de hacer push.

- [ ] **Paso 1: Agregar el helper al inicio del controller**

Editar `tukytukapi/controllers/payments.js`. Después de los `require`s y antes del primer handler:

```js
function appendEvent(payment, type, by, reason) {
    if (!Array.isArray(payment.events)) payment.events = [];
    const event = { type, at: new Date() };
    if (by != null) event.by = String(by);
    if (reason != null) event.reason = String(reason);
    payment.events.push(event);
}
```

- [ ] **Paso 2: Agregar evento `creado` en `uploadDriverPayment`**

En `controllers/payments.js`, dentro de `uploadDriverPayment`, antes de `await payment.save();`:

```js
appendEvent(payment, 'creado', req.uid);
```

- [ ] **Paso 3: Agregar evento `creado` en `adminCreatePayment`**

En `controllers/payments.js`, dentro de `adminCreatePayment`, antes de `await payment.save();` (justo después de construir `new Payment({...})`):

```js
appendEvent(payment, 'creado', req.uid);
```

- [ ] **Paso 4: Agregar evento `aprobado` en `adminApprovePayment`**

En `controllers/payments.js`, dentro de `adminApprovePayment`, antes de `await payment.save();`:

```js
appendEvent(payment, 'aprobado', req.uid);
```

- [ ] **Paso 5: Agregar evento `rechazado` en `adminRejectPayment`**

En `controllers/payments.js`, dentro de `adminRejectPayment`, antes de `await payment.save();`:

```js
appendEvent(payment, 'rechazado', req.uid, payment.adminComment);
```

- [ ] **Paso 6: Agregar tests al final de `tests/payments-events.test.js`**

```js
const mongoose = require('mongoose');
const Driver = require('../models/driver');
const Usuario = require('../models/usuario');

const Module = require('module');
const originalLoad = Module._load;
const ioCalls = [];
const fakeIo = { to(room) { return { emit(event, payload) { ioCalls.push({ room, event, payload }); } }; } };
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) return { io: fakeIo };
    return originalLoad(request, parent, isMain);
};

const { adminApprovePayment, adminRejectPayment } = require('../controllers/payments');

test.after(() => { Module._load = originalLoad; });

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminApprovePayment agrega evento aprobado al events', async (t) => {
    const origFindById = Payment.findById;
    const origPaymentFindOne = Payment.findOne;
    t.after(() => { Payment.findById = origFindById; Payment.findOne = origPaymentFindOne; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: driverId,
        durationDays: 30,
        status: 'pendiente',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;
    Payment.findOne = () => ({ sort: () => Promise.resolve(null) });

    const req = { uid: 'admin-uid', params: { id: 'p1' } };
    const res = makeRes();
    await adminApprovePayment(req, res);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'aprobado');
    assert.equal(paymentDoc.events[0].by, 'admin-uid');
});

test('adminRejectPayment agrega evento rechazado con reason', async (t) => {
    const origFindById = Payment.findById;
    t.after(() => { Payment.findById = origFindById; });

    const paymentDoc = {
        _id: new mongoose.Types.ObjectId(),
        driver: new mongoose.Types.ObjectId(),
        status: 'pendiente',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'admin-uid', params: { id: 'p1' }, body: { adminComment: 'foto borrosa' } };
    const res = makeRes();
    await adminRejectPayment(req, res);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'rechazado');
    assert.equal(paymentDoc.events[0].by, 'admin-uid');
    assert.equal(paymentDoc.events[0].reason, 'foto borrosa');
});
```

- [ ] **Paso 7: Correr tests focal + suite completa**

```bash
cd tukytukapi
node --test tests/payments-events.test.js
npm test
```

Esperado: tests nuevos pasan; suite completa sin regresiones.

- [ ] **Paso 8: Commit**

```bash
cd tukytukapi
git add controllers/payments.js tests/payments-events.test.js
git commit -m "feat(backend): helper appendEvent y eventos en handlers existentes de pagos"
```

---

## Task 3: GET /admin/list refactor a aggregate con $lookup

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (`adminListPayments`)
- Test: `tukytukapi/tests/payments-list-lookup.test.js` (crear)

**Interfaces:**
- Produces: `adminListPayments` ahora ejecuta un aggregate con `$lookup` y devuelve cada fila como `{ ...payment, driverNombre, driverApellido, driverPlate }`. Total y paginación con `$facet`.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/payments-list-lookup.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const { adminListPayments } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListPayments usa aggregate con $lookup a usuarios y drivers', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    let captured;
    Payment.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ payments: [], meta: [] }];
    };

    const req = { uid: 'admin1', query: {} };
    const res = makeRes();
    await adminListPayments(req, res);
    const lookupUsuario = captured.find(s => s.$lookup && s.$lookup.from === 'usuarios');
    const lookupDriver = captured.find(s => s.$lookup && s.$lookup.from === 'drivers');
    assert.ok(lookupUsuario);
    assert.ok(lookupDriver);
});

test('adminListPayments mapea el resultado con driverNombre y driverPlate', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    Payment.aggregate = async () => [{
        payments: [{
            _id: 'p1', amount: 200, durationDays: 30, status: 'pendiente',
            driverNombre: 'Juan', driverApellido: 'Pérez', driverPlate: 'P-1'
        }],
        meta: [{ total: 1 }]
    }];

    const req = { uid: 'admin1', query: {} };
    const res = makeRes();
    await adminListPayments(req, res);
    assert.equal(res.body.payments.length, 1);
    assert.equal(res.body.payments[0].driverNombre, 'Juan');
    assert.equal(res.body.payments[0].driverApellido, 'Pérez');
    assert.equal(res.body.payments[0].driverPlate, 'P-1');
    assert.equal(res.body.total, 1);
});

test('adminListPayments aplica filtros status y driverUid', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    let captured;
    Payment.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ payments: [], meta: [] }];
    };

    const req = { uid: 'admin1', query: { status: 'aprobado', driverUid: '507f1f77bcf86cd799439011' } };
    const res = makeRes();
    await adminListPayments(req, res);
    const matches = captured.filter(s => s.$match);
    // primer $match aplica los filtros del query
    const first = matches[0].$match;
    assert.equal(first.status, 'aprobado');
    assert.ok(first.driver);
});

test('adminListPayments capa limit a 100', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });
    Payment.aggregate = async () => [{ payments: [], meta: [] }];

    const req = { uid: 'admin1', query: { limit: '500' } };
    const res = makeRes();
    await adminListPayments(req, res);
    assert.equal(res.body.limit, 100);
});
```

- [ ] **Paso 2: Correr y confirmar que falla**

```bash
cd tukytukapi
node --test tests/payments-list-lookup.test.js
```

Esperado: falla (todavía no usa aggregate).

- [ ] **Paso 3: Refactor del handler**

En `controllers/payments.js`, reemplazar el cuerpo de `adminListPayments` por:

```js
const adminListPayments = async (req, res = response) => {
    try {
        const { status, driverUid } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

        const firstMatch = {};
        if (status) firstMatch.status = status;
        if (driverUid) {
            try { firstMatch.driver = new mongoose.Types.ObjectId(driverUid); }
            catch { firstMatch.driver = driverUid; }
        }

        const pipeline = [
            { $match: firstMatch },
            { $lookup: { from: 'usuarios', localField: 'driver', foreignField: '_id', as: '_usuario' } },
            { $unwind: { path: '$_usuario', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'drivers', localField: 'driver', foreignField: 'usuario', as: '_driver' } },
            { $unwind: { path: '$_driver', preserveNullAndEmptyArrays: true } },
            { $addFields: {
                driverNombre: '$_usuario.nombre',
                driverApellido: '$_usuario.apellido',
                driverPlate: '$_driver.plate'
            }},
            { $project: { _usuario: 0, _driver: 0 } },
            {
                $facet: {
                    payments: [
                        { $sort: { createdAt: -1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit }
                    ],
                    meta: [{ $count: 'total' }]
                }
            }
        ];

        const result = await Payment.aggregate(pipeline);
        const payments = (result[0]?.payments ?? []).map((p) => ({ ...p, uid: p._id }));
        const total = result[0]?.meta?.[0]?.total ?? 0;
        return res.status(200).json({ ok: true, payments, total, page, limit });
    } catch (err) {
        console.error('adminListPayments', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al inicio del archivo si no está: `const mongoose = require('mongoose');`.

- [ ] **Paso 4: Correr tests focal y suite**

```bash
cd tukytukapi
node --test tests/payments-list-lookup.test.js
npm test
```

Esperado: tests del task pasan; suite completa OK.

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add controllers/payments.js tests/payments-list-lookup.test.js
git commit -m "feat(backend): adminListPayments aggregate con lookup a usuario y driver"
```

---

## Task 4: GET /admin/:id (detalle)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (agregar `adminGetPaymentDetail`)
- Modify: `tukytukapi/routes/payments.js` (ruta nueva)
- Test: `tukytukapi/tests/payments-detail.test.js` (crear)

**Interfaces:**
- Produces: handler `adminGetPaymentDetail(req, res)`; ruta `GET /api/payments/admin/:id`. Devuelve `{ ok, payment, driverNombre, driverApellido, driverPlate }`. 404 si no existe.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/payments-detail.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../models/payment');
const { adminGetPaymentDetail } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetPaymentDetail 404 si no existe', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });
    Payment.aggregate = async () => [];

    const req = { uid: 'a1', params: { id: 'no-existe' } };
    const res = makeRes();
    await adminGetPaymentDetail(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetPaymentDetail 200 con shape esperado', async (t) => {
    const orig = Payment.aggregate;
    t.after(() => { Payment.aggregate = orig; });

    Payment.aggregate = async () => [{
        _id: 'p1', amount: 200, durationDays: 30, status: 'pendiente',
        events: [{ type: 'creado', at: new Date(), by: 'admin' }],
        driverNombre: 'Juan', driverApellido: 'Pérez', driverPlate: 'P-1'
    }];

    const req = { uid: 'a1', params: { id: 'p1' } };
    const res = makeRes();
    await adminGetPaymentDetail(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.payment.amount, 200);
    assert.equal(res.body.payment.uid, 'p1');
    assert.equal(res.body.driverNombre, 'Juan');
    assert.equal(res.body.driverPlate, 'P-1');
});
```

- [ ] **Paso 2: Implementar el handler**

En `controllers/payments.js`, agregar antes del `module.exports`:

```js
const adminGetPaymentDetail = async (req, res = response) => {
    try {
        const { id } = req.params;
        let oid;
        try { oid = new mongoose.Types.ObjectId(id); }
        catch { return res.status(400).json({ ok: false, msg: 'id inválido' }); }

        const pipeline = [
            { $match: { _id: oid } },
            { $lookup: { from: 'usuarios', localField: 'driver', foreignField: '_id', as: '_usuario' } },
            { $unwind: { path: '$_usuario', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'drivers', localField: 'driver', foreignField: 'usuario', as: '_driver' } },
            { $unwind: { path: '$_driver', preserveNullAndEmptyArrays: true } },
            { $addFields: {
                driverNombre: '$_usuario.nombre',
                driverApellido: '$_usuario.apellido',
                driverPlate: '$_driver.plate'
            }},
            { $project: { _usuario: 0, _driver: 0 } }
        ];

        const result = await Payment.aggregate(pipeline);
        if (!result.length) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        const row = result[0];
        const { driverNombre, driverApellido, driverPlate, ...payment } = row;
        payment.uid = payment._id;
        return res.status(200).json({
            ok: true, payment, driverNombre, driverApellido, driverPlate
        });
    } catch (err) {
        console.error('adminGetPaymentDetail', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar `adminGetPaymentDetail` al `module.exports`.

- [ ] **Paso 3: Agregar la ruta**

En `routes/payments.js`, agregar entre `/admin/list` y `/admin/:id/approve`:

```js
router.get('/admin/:id',
    [validarJWT, validarAdmin],
    paymentsController.adminGetPaymentDetail
);
```

**Importante:** debe ir ANTES de cualquier `/admin/:id/algo` para que Express matchee correctamente.

- [ ] **Paso 4: Tests y suite**

```bash
cd tukytukapi
node --test tests/payments-detail.test.js
npm test
```

Esperado: pasa.

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js tests/payments-detail.test.js
git commit -m "feat(backend): endpoint admin GET /payments/admin/:id (detalle con lookup)"
```

---

## Task 5: PATCH /admin/:id (editar comentario + reemplazar comprobante)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (`adminPatchPayment`)
- Modify: `tukytukapi/routes/payments.js` (ruta + middleware multer-error)
- Test: `tukytukapi/tests/payments-patch.test.js` (crear)

**Interfaces:**
- Produces: handler `adminPatchPayment(req, res)`; ruta `PATCH /api/payments/admin/:id` (multipart, campo opcional `imagen` + body opcional `adminComment`). 409 si `status === 'aprobado' || 'vencido'`. Borra el archivo viejo si reemplaza comprobante.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/payments-patch.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../models/payment');
const { adminPatchPayment } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminPatchPayment 404 si no existe', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => null;

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminPatchPayment 409 si status es aprobado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'aprobado', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminPatchPayment 409 si status es vencido', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'vencido', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'x' }, body: { adminComment: 'algo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminPatchPayment 200 actualiza adminComment y agrega evento comentario_editado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'pendiente',
        adminComment: 'viejo',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    const req = { uid: 'admin1', params: { id: 'x' }, body: { adminComment: 'nuevo' }, file: null };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.adminComment, 'nuevo');
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comentario_editado');
    assert.equal(paymentDoc.events[0].by, 'admin1');
    assert.equal(paymentDoc.events[0].reason, 'nuevo');
});

test('adminPatchPayment 200 con file reemplaza receiptUrl y agrega evento comprobante_actualizado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });

    const paymentDoc = {
        status: 'rechazado',
        receiptUrl: '/api/payments/receipt/viejo.jpg',
        events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    // Stub fs.unlink para evitar tocar disco
    const fs = require('fs');
    const origUnlink = fs.unlink;
    let unlinked;
    fs.unlink = (p, cb) => { unlinked = p; cb && cb(null); };
    t.after(() => { fs.unlink = origUnlink; });

    const req = { uid: 'admin1', params: { id: 'x' }, body: {}, file: { filename: 'nuevo.jpg' } };
    const res = makeRes();
    await adminPatchPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.receiptUrl, '/api/payments/receipt/nuevo.jpg');
    assert.match(unlinked || '', /viejo\.jpg$/);
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'comprobante_actualizado');
});
```

- [ ] **Paso 2: Implementar el handler**

En `controllers/payments.js`, agregar antes del `module.exports`:

```js
const adminPatchPayment = async (req, res = response) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status === 'aprobado' || payment.status === 'vencido') {
            return res.status(409).json({ ok: false, msg: 'No se puede editar un pago cerrado' });
        }

        let changed = false;

        const newComment = req.body && req.body.adminComment;
        if (newComment != null && String(newComment) !== String(payment.adminComment || '')) {
            payment.adminComment = String(newComment);
            appendEvent(payment, 'comentario_editado', req.uid, payment.adminComment);
            changed = true;
        }

        if (req.file) {
            const oldUrl = payment.receiptUrl;
            payment.receiptUrl = `/api/payments/receipt/${req.file.filename}`;
            appendEvent(payment, 'comprobante_actualizado', req.uid);
            changed = true;

            if (oldUrl && oldUrl.startsWith('/api/payments/receipt/')) {
                const oldName = oldUrl.split('/').pop();
                if (oldName) {
                    const oldPath = path.resolve('uploads/payments', oldName);
                    fs.unlink(oldPath, () => {});
                }
            }
        }

        if (!changed) {
            return res.status(400).json({ ok: false, msg: 'Sin cambios' });
        }

        await payment.save();
        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminPatchPayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar `adminPatchPayment` al `module.exports`.

- [ ] **Paso 3: Agregar middleware de error multer y ruta**

En `routes/payments.js`, agregar el adapter de multer al inicio del archivo (después de los imports):

```js
const uploadPaymentReceiptMw = (req, res, next) => {
    upload.single('imagen')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'archivo_demasiado_grande'
                : err.message === 'TIPO_INVALIDO'
                    ? 'tipo_invalido'
                    : 'error_de_subida';
            return res.status(400).json({ ok: false, msg });
        }
        next();
    });
};
```

(Si `upload` no está importado todavía, importarlo: `const upload = require('../helpers/upload');`. Si ya estaba como `paymentsUpload` u otro nombre, ajustar.)

Y agregar la ruta:

```js
router.patch('/admin/:id',
    [validarJWT, validarAdmin, uploadPaymentReceiptMw],
    paymentsController.adminPatchPayment
);
```

- [ ] **Paso 4: Tests y suite**

```bash
cd tukytukapi
node --test tests/payments-patch.test.js
npm test
```

Esperado: pasa.

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js tests/payments-patch.test.js
git commit -m "feat(backend): endpoint admin PATCH /payments/admin/:id (editar comentario + reemplazar comprobante)"
```

---

## Task 6: POST /admin/:id/expire (individual)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (`adminExpirePayment`)
- Modify: `tukytukapi/routes/payments.js` (ruta)
- Test: `tukytukapi/tests/payments-expire-individual.test.js` (crear)

**Interfaces:**
- Produces: handler `adminExpirePayment(req, res)`; ruta `POST /api/payments/admin/:id/expire`. 200 si aprobado → vencido, 409 si no es aprobado, 404 si no existe. Setea `Usuario.online=false`.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/payments-expire-individual.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Usuario = require('../models/usuario');
const { adminExpirePayment } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminExpirePayment 404 si no existe', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => null;

    const req = { uid: 'a1', params: { id: 'x' } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminExpirePayment 409 si status no es aprobado', async (t) => {
    const orig = Payment.findById;
    t.after(() => { Payment.findById = orig; });
    Payment.findById = async () => ({ status: 'pendiente', events: [], save: async function() { return this; } });

    const req = { uid: 'a1', params: { id: 'x' } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 409);
});

test('adminExpirePayment 200 marca vencido, evento con by=admin, desactiva conductor', async (t) => {
    const origFindById = Payment.findById;
    const origUpdateOne = Usuario.updateOne;
    t.after(() => { Payment.findById = origFindById; Usuario.updateOne = origUpdateOne; });

    const driverId = new mongoose.Types.ObjectId();
    const paymentDoc = {
        driver: driverId, status: 'aprobado', events: [],
        save: async function() { return this; }
    };
    Payment.findById = async () => paymentDoc;

    let updateCall;
    Usuario.updateOne = async (filter, update) => { updateCall = { filter, update }; return { matchedCount: 1, modifiedCount: 1 }; };

    const req = { uid: 'admin1', params: { id: 'x' } };
    const res = makeRes();
    await adminExpirePayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(paymentDoc.status, 'vencido');
    assert.equal(paymentDoc.events.length, 1);
    assert.equal(paymentDoc.events[0].type, 'vencido');
    assert.equal(paymentDoc.events[0].by, 'admin1');
    assert.equal(String(updateCall.filter._id), String(driverId));
    assert.equal(updateCall.update.$set.online, false);
});
```

- [ ] **Paso 2: Implementar el handler**

En `controllers/payments.js`, agregar antes del `module.exports`:

```js
const adminExpirePayment = async (req, res = response) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }
        if (payment.status !== 'aprobado') {
            return res.status(409).json({ ok: false, msg: 'Solo se pueden vencer pagos aprobados' });
        }
        payment.status = 'vencido';
        appendEvent(payment, 'vencido', req.uid);
        await payment.save();

        await Usuario.updateOne(
            { _id: payment.driver, type: 'C' },
            { $set: { online: false } }
        );

        return res.status(200).json({ ok: true, payment });
    } catch (err) {
        console.error('adminExpirePayment', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 3: Agregar la ruta**

En `routes/payments.js`, junto a las otras rutas admin:

```js
router.post('/admin/:id/expire',
    [validarJWT, validarAdmin],
    paymentsController.adminExpirePayment
);
```

- [ ] **Paso 4: Tests y suite**

```bash
cd tukytukapi
node --test tests/payments-expire-individual.test.js
npm test
```

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js tests/payments-expire-individual.test.js
git commit -m "feat(backend): endpoint admin POST /payments/admin/:id/expire (vencimiento individual)"
```

---

## Task 7: POST /admin/expire-overdue (masivo)

**Files:**
- Modify: `tukytukapi/controllers/payments.js` (`adminExpireOverdue`)
- Modify: `tukytukapi/routes/payments.js`
- Test: `tukytukapi/tests/payments-expire-overdue.test.js` (crear)

**Interfaces:**
- Produces: handler `adminExpireOverdue(req, res)`; ruta `POST /api/payments/admin/expire-overdue`. Devuelve `{ ok, expiredCount, deactivatedDrivers }`. Cada pago marcado lleva `by: 'system'`. Idempotente.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/payments-expire-overdue.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Payment = require('../models/payment');
const Usuario = require('../models/usuario');
const { adminExpireOverdue } = require('../controllers/payments');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminExpireOverdue caso sin pagos vencidos devuelve 0/0', async (t) => {
    const orig = Payment.find;
    t.after(() => { Payment.find = orig; });
    Payment.find = async () => [];

    const req = { uid: 'admin1' };
    const res = makeRes();
    await adminExpireOverdue(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.expiredCount, 0);
    assert.equal(res.body.deactivatedDrivers, 0);
});

test('adminExpireOverdue marca pagos como vencidos con by=system y desactiva conductores únicos', async (t) => {
    const origFind = Payment.find;
    const origUpdateOne = Usuario.updateOne;
    t.after(() => { Payment.find = origFind; Usuario.updateOne = origUpdateOne; });

    const driver1 = new mongoose.Types.ObjectId();
    const driver2 = new mongoose.Types.ObjectId();
    const p1 = { driver: driver1, status: 'aprobado', events: [], save: async function() { return this; } };
    const p2 = { driver: driver1, status: 'aprobado', events: [], save: async function() { return this; } }; // mismo driver
    const p3 = { driver: driver2, status: 'aprobado', events: [], save: async function() { return this; } };
    Payment.find = async () => [p1, p2, p3];

    let updateCalls = 0;
    Usuario.updateOne = async () => { updateCalls++; return { matchedCount: 1, modifiedCount: 1 }; };

    const req = { uid: 'admin1' };
    const res = makeRes();
    await adminExpireOverdue(req, res);
    assert.equal(res.body.expiredCount, 3);
    assert.equal(res.body.deactivatedDrivers, 2);  // únicos
    assert.equal(updateCalls, 2);
    assert.equal(p1.status, 'vencido');
    assert.equal(p1.events[0].type, 'vencido');
    assert.equal(p1.events[0].by, 'system');
});
```

- [ ] **Paso 2: Implementar el handler**

En `controllers/payments.js`:

```js
const adminExpireOverdue = async (req, res = response) => {
    try {
        const now = new Date();
        const overdue = await Payment.find({
            status: 'aprobado',
            expiresAt: { $lt: now }
        });

        const driversSet = new Set();
        for (const p of overdue) {
            p.status = 'vencido';
            appendEvent(p, 'vencido', 'system');
            await p.save();
            driversSet.add(String(p.driver));
        }

        for (const driverUid of driversSet) {
            await Usuario.updateOne(
                { _id: driverUid, type: 'C' },
                { $set: { online: false } }
            );
        }

        return res.status(200).json({
            ok: true,
            expiredCount: overdue.length,
            deactivatedDrivers: driversSet.size
        });
    } catch (err) {
        console.error('adminExpireOverdue', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 3: Agregar la ruta**

En `routes/payments.js`:

```js
router.post('/admin/expire-overdue',
    [validarJWT, validarAdmin],
    paymentsController.adminExpireOverdue
);
```

- [ ] **Paso 4: Tests y suite completa**

```bash
cd tukytukapi
node --test tests/payments-expire-overdue.test.js
npm test
```

Esperado: pasa.

- [ ] **Paso 5: Commit**

```bash
cd tukytukapi
git add controllers/payments.js routes/payments.js tests/payments-expire-overdue.test.js
git commit -m "feat(backend): endpoint admin POST /payments/admin/expire-overdue (vencimiento masivo)"
```

---

## Task 8: ToastProvider + useToast + wire en JournalRoutes

**Files:**
- Create: `tukytuk-admin/src/components/toast/ToastProvider.tsx`
- Create: `tukytuk-admin/src/components/toast/useToast.ts`
- Modify: `tukytuk-admin/src/journal/routes/JournalRoutes.jsx`

**Interfaces:**
- Produces: `useToast() → { success, error, info }`. `<ToastProvider>` envuelve `<AdminLayout>` para que toda pantalla admin tenga acceso al hook.

- [ ] **Paso 1: Crear `useToast.ts`**

Crear `tukytuk-admin/src/components/toast/useToast.ts`:

```ts
import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

export const ToastContext = createContext<Toast | null>(null);

export function useToast(): Toast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
```

- [ ] **Paso 2: Crear `ToastProvider.tsx`**

Crear `tukytuk-admin/src/components/toast/ToastProvider.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { ToastContext, type Toast, type ToastKind } from './useToast';

interface Item {
  id: number;
  kind: ToastKind;
  text: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Item | null>(null);
  const idRef = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++idRef.current;
    setQueue((q) => [...q, { id, kind, text }]);
  }, []);

  // Toma el siguiente cuando no hay nada en pantalla
  if (!current && queue.length) {
    const [next, ...rest] = queue;
    setCurrent(next);
    setQueue(rest);
  }

  const onClose = (_e: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setCurrent(null);
  };

  const toast: Toast = useMemo(() => ({
    success: (t) => push('success', t),
    error: (t) => push('error', t),
    info: (t) => push('info', t),
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Snackbar
        open={!!current}
        autoHideDuration={3000}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert severity={current.kind} onClose={() => setCurrent(null)} variant="filled">
            {current.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
```

- [ ] **Paso 3: Envolver en `JournalRoutes.jsx`**

Editar `src/journal/routes/JournalRoutes.jsx`. Importar `ToastProvider` y envolver `<AdminLayout>`:

```jsx
import { ToastProvider } from "../../components/toast/ToastProvider"
// ...
<Routes>
  <Route element={
    <ToastProvider>
      <AdminLayout />
    </ToastProvider>
  }>
    {/* ... rutas existentes ... */}
  </Route>
</Routes>
```

- [ ] **Paso 4: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero warnings, build OK.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk-admin
git add src/components/toast/ToastProvider.tsx src/components/toast/useToast.ts src/journal/routes/JournalRoutes.jsx
git commit -m "feat(admin): ToastProvider y hook useToast envolviendo AdminLayout"
```

---

## Task 9: Migrar Snackbar local a useToast en pantallas existentes

**Files:**
- Modify: `tukytuk-admin/src/admin/drivers/DriverDetailPage.tsx`
- Modify: `tukytuk-admin/src/admin/drivers/DriversListPage.tsx`
- Modify: `tukytuk-admin/src/components/DriverImagePicker.tsx`
- Modify: `tukytuk-admin/src/admin/payments/PaymentsListPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/CreateManualPaymentPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/PaymentSettingsPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/SpecialPricingPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/SpecialPricingDialog.tsx`

**Interfaces:**
- Consumes: `useToast()` de Task 8.

**Estrategia única para cada archivo:**
1. Importar `useToast` desde `../../components/toast/useToast`.
2. Dentro del componente: `const toast = useToast();`.
3. Eliminar `<Snackbar>` y sus props del JSX.
4. Eliminar `useState` de `snack`/`msg`/`setSnack`/`setMsg`.
5. Reemplazar cada `setSnack({ kind: 'ok', text: '...' })` por `toast.success('...')` y `setSnack({ kind: 'err', text: '...' })` por `toast.error('...')`.
6. Si la página usa `Alert` inline para errores de carga inicial (no de acción), MANTENERLO. Solo migrar los Snackbar/SnackBar de acciones.

- [ ] **Paso 1: Migrar `DriverDetailPage.tsx`**

Aplicar la estrategia. El `setSnack` aparece en `doSave` y en `onImageUpdated` indirectamente vía `DriverImagePicker` (que se migra aparte).

- [ ] **Paso 2: Migrar `DriversListPage.tsx`**

`onApprove` y `onConfirmReject` ahora llaman `toast.success('Conductor aprobado')` y `toast.success('Conductor rechazado')` respectivamente. El catch existente que llamaba `setError` para esos flujos pasa a `toast.error('No se pudo aprobar/rechazar')`. El `Alert` de error de `load` se mantiene como estado de pantalla (no es acción).

- [ ] **Paso 3: Migrar `DriverImagePicker.tsx`**

Eliminar `<Snackbar>` local. `toast.success('Imagen actualizada')` y `toast.error('No se pudo subir la imagen')`.

- [ ] **Paso 4: Migrar `PaymentsListPage.tsx`**

`onApprove` / `onConfirmReject` → `toast.success/error`. El `error` state que existe para errores de carga inicial se mantiene como `<Alert>` inline.

- [ ] **Paso 5: Migrar `CreateManualPaymentPage.tsx`**

Eliminar `msg` state + `<Alert>` inline de feedback. Reemplazar `setMsg({ kind: 'ok', ... })` por `toast.success` y `setMsg({ kind: 'err', ... })` por `toast.error`. (El fix del botón viene en T10.)

- [ ] **Paso 6: Migrar `PaymentSettingsPage.tsx`**

Mismo patrón.

- [ ] **Paso 7: Migrar `SpecialPricingPage.tsx`**

Mismo patrón. Ya usa SnackBar para "Precio especial actualizado / eliminado" → `toast.success`.

- [ ] **Paso 8: Migrar `SpecialPricingDialog.tsx`**

El dialog usa Alert inline (no Snackbar) en su contenido para errores. Mantener ese Alert (es estado del dialog, no toast).

- [ ] **Paso 9: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero warnings, build OK.

- [ ] **Paso 10: Commit**

```bash
cd tukytuk-admin
git add src/admin/drivers/DriverDetailPage.tsx src/admin/drivers/DriversListPage.tsx src/components/DriverImagePicker.tsx src/admin/payments/PaymentsListPage.tsx src/admin/payments/CreateManualPaymentPage.tsx src/admin/payments/PaymentSettingsPage.tsx src/admin/payments/SpecialPricingPage.tsx src/admin/payments/SpecialPricingDialog.tsx
git commit -m "refactor(admin): migrar Snackbar local a useToast global"
```

---

## Task 10: Fix botón "Adjuntar comprobante" en CreateManualPaymentPage

**Files:**
- Modify: `tukytuk-admin/src/admin/payments/CreateManualPaymentPage.tsx`

**Interfaces:** ninguna nueva.

- [ ] **Paso 1: Aplicar el fix**

En `src/admin/payments/CreateManualPaymentPage.tsx`, reemplazar el bloque del `<Button component="label">` por el patrón con `useRef` + `inputRef.current?.click()`:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
const onPickFile = () => inputRef.current?.click();
```

Y en el JSX donde estaba el `<Button component="label">`:

```tsx
<Button variant="outlined" onClick={onPickFile} disabled={busy}>
  {receipt ? `Comprobante: ${receipt.name}` : 'Adjuntar comprobante (opcional)'}
</Button>
<input
  ref={inputRef}
  type="file"
  style={{ display: 'none' }}
  accept="image/jpeg,image/png,image/webp"
  onChange={(e) => {
    setReceipt(e.target.files?.[0] ?? null);
    e.target.value = '';
  }}
/>
```

Importar `useRef` si no estaba.

- [ ] **Paso 2: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

- [ ] **Paso 3: Verificación manual**

Si el dev server está corriendo: ir a `/admin/pagos/nuevo`, click en "Adjuntar comprobante", el file picker debe abrirse, seleccionar PNG, el botón muestra el nombre del archivo.

- [ ] **Paso 4: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/CreateManualPaymentPage.tsx
git commit -m "fix(admin): boton Adjuntar comprobante en CreateManualPaymentPage abre file picker"
```

---

## Task 11: Mostrar nombre+placa + filtro Vencido + driverLabel

**Files:**
- Modify: `tukytuk-admin/src/admin/payments/PaymentsListPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/SpecialPricingDialog.tsx`
- Modify: `tukytuk-admin/src/admin/payments/SpecialPricingPage.tsx`
- Modify: `tukytuk-admin/src/admin/drivers/DriverDetailPage.tsx`

**Interfaces:**
- Consumes: shape ampliado de `listPayments` (Task 3 backend ya devuelve `driverNombre`, `driverApellido`, `driverPlate`).
- Produces: `SpecialPricingDialog` gana prop opcional `driverLabel?: string`.

- [ ] **Paso 1: Extender el tipo `Payment` en `src/api/payments.ts`**

Editar `src/api/payments.ts`. En la interfaz `Payment`, agregar opcionales:

```ts
export interface Payment {
  // ... campos existentes
  driverNombre?: string;
  driverApellido?: string;
  driverPlate?: string;
}
```

Y cambiar el literal de status:

```ts
status: 'pendiente' | 'aprobado' | 'rechazado' | 'vencido';
```

- [ ] **Paso 2: Mostrar nombre+placa en `PaymentsListPage.tsx`**

En la columna "Conductor" de la tabla, reemplazar `{p.driver}` por:

```tsx
{p.driverNombre || p.driverApellido || p.driverPlate
  ? `${p.driverNombre ?? ''} ${p.driverApellido ?? ''}`.trim() + (p.driverPlate ? ` — ${p.driverPlate}` : '')
  : '—'}
```

- [ ] **Paso 3: Agregar filtro "Vencido"**

En el `<TextField select label="Estado">` agregar `<MenuItem value="vencido">Vencido</MenuItem>` y actualizar el tipo del estado del filter para aceptarlo (Spec 4 ya lo hace al cambiar `Payment.status`).

- [ ] **Paso 4: Agregar prop `driverLabel` a `SpecialPricingDialog`**

Editar `src/admin/payments/SpecialPricingDialog.tsx`. Agregar a `Props`:

```ts
driverLabel?: string;
```

Cambiar la prop al destructurar y modificar el `<DialogTitle>`:

```tsx
<DialogTitle>Precio especial — {driverLabel ?? 'conductor'}</DialogTitle>
```

- [ ] **Paso 5: Pasar `driverLabel` desde `DriverDetailPage.tsx`**

En el `<SpecialPricingDialog ...>` agregar:

```tsx
driverLabel={`${fullName}${data.driver.plate ? ' — ' + data.driver.plate : ''}`}
```

- [ ] **Paso 6: Pasar `driverLabel` desde `SpecialPricingPage.tsx`**

Esta página tiene `driverUid` como input. Para tener el label, necesita hacer una lookup. Opciones:
- Reusar el state del `DriverAutocomplete` que ya resuelve un label (`onChange(uid, label)`).

Editar el handler del autocomplete:

```tsx
const [driverLabel, setDriverLabel] = useState<string>('');
// ...
<DriverAutocomplete
  value={driverUid || null}
  onChange={(uid, label) => {
    setDriverUid(uid ?? '');
    setDriverLabel(label);
  }}
  label="Conductor"
  required
/>
```

Y pasarlo al dialog:

```tsx
<SpecialPricingDialog
  open={dialogOpen}
  driverUid={driverUid}
  driverLabel={driverLabel || undefined}
  onClose={() => setDialogOpen(false)}
  onSaved={...}
/>
```

- [ ] **Paso 7: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

- [ ] **Paso 8: Commit**

```bash
cd tukytuk-admin
git add src/api/payments.ts src/admin/payments/PaymentsListPage.tsx src/admin/payments/SpecialPricingDialog.tsx src/admin/payments/SpecialPricingPage.tsx src/admin/drivers/DriverDetailPage.tsx
git commit -m "feat(admin): nombre y placa en pagos, filtro Vencido, driverLabel en SpecialPricingDialog"
```

---

## Task 12: Cliente API para detalle, patch, expire individual y masivo

**Files:**
- Modify: `tukytuk-admin/src/api/payments.ts`

**Interfaces:**
- Produces:
  - `interface PaymentEvent { type: string; at: string; by?: string; reason?: string }`.
  - `interface PaymentDetail { payment: Payment & { events: PaymentEvent[] }; driverNombre?: string; driverApellido?: string; driverPlate?: string }`.
  - `getPayment(id)`, `patchPayment(id, form)`, `expirePayment(id)`, `expireOverduePayments()`.

- [ ] **Paso 1: Agregar interfaces**

Editar `src/api/payments.ts`. Al final del archivo (después de las interfaces existentes):

```ts
export interface PaymentEvent {
  type: string;
  at: string;
  by?: string;
  reason?: string;
}

export interface PaymentDetail {
  payment: Payment & { events: PaymentEvent[] };
  driverNombre?: string;
  driverApellido?: string;
  driverPlate?: string;
}
```

Extender `Payment` con `events?: PaymentEvent[]`:

```ts
export interface Payment {
  // ... campos existentes
  events?: PaymentEvent[];
}
```

- [ ] **Paso 2: Agregar las 4 funciones**

```ts
export async function getPayment(id: string): Promise<PaymentDetail> {
  const res = await apiClient.get<{ ok: boolean; payment: Payment & { events: PaymentEvent[] }; driverNombre?: string; driverApellido?: string; driverPlate?: string }>(
    `/payments/admin/${id}`
  );
  return {
    payment: res.data.payment,
    driverNombre: res.data.driverNombre,
    driverApellido: res.data.driverApellido,
    driverPlate: res.data.driverPlate
  };
}

export async function patchPayment(id: string, form: FormData): Promise<Payment> {
  const res = await apiClient.patch<{ ok: boolean; payment: Payment }>(
    `/payments/admin/${id}`, form
  );
  return res.data.payment;
}

export async function expirePayment(id: string): Promise<Payment> {
  const res = await apiClient.post<{ ok: boolean; payment: Payment }>(
    `/payments/admin/${id}/expire`, {}
  );
  return res.data.payment;
}

export async function expireOverduePayments(): Promise<{ expiredCount: number; deactivatedDrivers: number }> {
  const res = await apiClient.post<{ ok: boolean; expiredCount: number; deactivatedDrivers: number }>(
    `/payments/admin/expire-overdue`, {}
  );
  return { expiredCount: res.data.expiredCount, deactivatedDrivers: res.data.deactivatedDrivers };
}
```

- [ ] **Paso 3: Lint**

```bash
cd tukytuk-admin
npm run lint
```

Esperado: cero warnings.

- [ ] **Paso 4: Commit**

```bash
cd tukytuk-admin
git add src/api/payments.ts
git commit -m "feat(admin): api client de pagos con detalle, patch, expire individual y masivo"
```

---

## Task 13: PaymentDetailPage + EventTimeline

**Files:**
- Create: `tukytuk-admin/src/admin/payments/PaymentDetailPage.tsx`
- Create: `tukytuk-admin/src/admin/payments/EventTimeline.tsx`
- Modify: `tukytuk-admin/src/journal/routes/JournalRoutes.jsx`

**Interfaces:**
- Consumes: `getPayment`, `patchPayment`, `expirePayment`, `approvePayment`, `rejectPayment` (existente), `<PageBreadcrumbs>`, `<AuthImage>`, `useToast()`.
- Produces: pantalla en ruta `/admin/pagos/:id`.

- [ ] **Paso 1: Crear `EventTimeline.tsx`**

Crear `tukytuk-admin/src/admin/payments/EventTimeline.tsx`:

```tsx
import { Box, Typography } from '@mui/material';
import type { PaymentEvent } from '../../api/payments';

interface Props {
  events: PaymentEvent[];
  createdAt?: string;
}

const COLOR: Record<string, string> = {
  creado: '#3b82f6',
  aprobado: '#16a34a',
  rechazado: '#dc2626',
  vencido: '#6b7280',
  comprobante_actualizado: '#0ea5e9',
  comentario_editado: '#64748b'
};

const LABEL: Record<string, string> = {
  creado: 'Pago creado',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  vencido: 'Vencido',
  comprobante_actualizado: 'Comprobante actualizado',
  comentario_editado: 'Comentario editado'
};

function formatBy(by?: string) {
  if (!by) return '';
  if (by === 'system') return 'Sistema';
  return by;  // uid; el spec acepta no resolverlo a nombre humano
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-GT');
  } catch {
    return iso;
  }
}

export function EventTimeline({ events, createdAt }: Props) {
  const items: PaymentEvent[] = events.length
    ? events
    : createdAt
      ? [{ type: 'creado', at: createdAt }]
      : [];

  if (!items.length) return <Typography variant="body2" color="text.secondary">Sin historial</Typography>;

  return (
    <Box>
      {items.map((e, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLOR[e.type] ?? '#94a3b8', mt: 0.75 }} />
          <Box>
            <Typography variant="body2"><strong>{LABEL[e.type] ?? e.type}</strong> · {formatDate(e.at)}{e.by ? ` · ${formatBy(e.by)}` : ''}</Typography>
            {e.reason && <Typography variant="caption" color="text.secondary">{e.reason}</Typography>}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Paso 2: Crear `PaymentDetailPage.tsx`**

Crear `tukytuk-admin/src/admin/payments/PaymentDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Button, Stack, TextField, Card, CardContent,
  CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Chip
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { AuthImage } from '../../components/AuthImage';
import { useToast } from '../../components/toast/useToast';
import { EventTimeline } from './EventTimeline';
import {
  getPayment, patchPayment, expirePayment,
  approvePayment, rejectPayment,
  type PaymentDetail
} from '../../api/payments';

const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', vencido: 'Vencido'
};
const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default'> = {
  pendiente: 'warning', aprobado: 'success', rechazado: 'error', vencido: 'default'
};

export default function PaymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminComment, setAdminComment] = useState<string>('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [expireOpen, setExpireOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await getPayment(id);
      setData(r);
      setAdminComment(r.payment.adminComment ?? '');
      setReceipt(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el pago');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const fullName = useMemo(() => {
    if (!data) return '';
    const a = [data.driverNombre, data.driverApellido].filter(Boolean).join(' ');
    return a || 'Conductor';
  }, [data]);

  const isClosed = data?.payment.status === 'aprobado' || data?.payment.status === 'vencido';

  const save = async () => {
    if (!data) return;
    const form = new FormData();
    let dirty = false;
    if (adminComment !== (data.payment.adminComment ?? '')) {
      form.append('adminComment', adminComment); dirty = true;
    }
    if (receipt) { form.append('imagen', receipt); dirty = true; }
    if (!dirty) { toast.info('Sin cambios'); return; }

    setBusy(true);
    try {
      await patchPayment(id, form);
      toast.success('Pago actualizado');
      await load();
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) && e.response?.data?.msg
        ? `No se pudo guardar: ${e.response.data.msg}`
        : 'No se pudo guardar';
      toast.error(msg);
    } finally { setBusy(false); }
  };

  const onApprove = async () => {
    setBusy(true);
    try {
      await approvePayment(id);
      toast.success('Pago aprobado');
      await load();
    } catch { toast.error('No se pudo aprobar'); }
    finally { setBusy(false); }
  };

  const onConfirmReject = async () => {
    if (rejectComment.trim().length < 3) return;
    setBusy(true);
    try {
      await rejectPayment(id, rejectComment.trim());
      setRejectOpen(false); setRejectComment('');
      toast.success('Pago rechazado');
      await load();
    } catch { toast.error('No se pudo rechazar'); }
    finally { setBusy(false); }
  };

  const onConfirmExpire = async () => {
    setBusy(true);
    try {
      await expirePayment(id);
      setExpireOpen(false);
      toast.success('Pago marcado como vencido');
      await load();
    } catch { toast.error('No se pudo vencer'); }
    finally { setBusy(false); }
  };

  if (loading) return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (error || !data) return <Box sx={{ p: 3 }}><Alert severity="error">{error ?? 'Pago no encontrado'}</Alert></Box>;

  const p = data.payment;
  const breadcrumbs = [
    { label: 'Inicio', to: '/' },
    { label: 'Pagos', to: '/admin/pagos' },
    { label: `Pago de ${fullName}` }
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PageBreadcrumbs items={breadcrumbs} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4">
          Pago de {fullName}{data.driverPlate ? ` — ${data.driverPlate}` : ''}
        </Typography>
        <Stack direction="row" spacing={1}>
          {p.status === 'pendiente' && (
            <>
              <Button variant="contained" color="success" onClick={onApprove} disabled={busy}>Aprobar</Button>
              <Button variant="contained" color="error" onClick={() => setRejectOpen(true)} disabled={busy}>Rechazar</Button>
            </>
          )}
          {p.status === 'aprobado' && (
            <Button variant="outlined" color="warning" onClick={() => setExpireOpen(true)} disabled={busy}>
              Marcar como vencido
            </Button>
          )}
        </Stack>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={1.5}>
            <Box><Typography variant="caption" color="text.secondary">Estado</Typography>
              <Box><Chip label={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} size="small" /></Box>
            </Box>
            <Box><Typography variant="caption" color="text.secondary">Monto</Typography>
              <Typography>{p.amount} por {p.durationDays} días</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">Creado por</Typography>
              <Typography>{p.createdBy === 'admin' ? 'Admin' : 'Conductor'}</Typography></Box>
            {p.startsAt && p.expiresAt && (
              <Box><Typography variant="caption" color="text.secondary">Vigencia</Typography>
                <Typography>{new Date(p.startsAt).toLocaleDateString('es-GT')} → {new Date(p.expiresAt).toLocaleDateString('es-GT')}</Typography></Box>
            )}
            <TextField
              label="Comentario admin" fullWidth multiline minRows={2}
              value={adminComment}
              onChange={(e) => setAdminComment(e.target.value)}
              disabled={isClosed || busy}
            />
            {p.receiptUrl && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Comprobante</Typography>
                <AuthImage receiptUrl={p.receiptUrl} style={{ maxWidth: 280, maxHeight: 280 }} />
              </Box>
            )}
            {!isClosed && (
              <Stack direction="row" spacing={2} alignItems="center">
                <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy}>
                  {receipt ? `Reemplazar: ${receipt.name}` : 'Reemplazar comprobante'}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  style={{ display: 'none' }}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => { setReceipt(e.target.files?.[0] ?? null); e.target.value = ''; }}
                />
              </Stack>
            )}
            {isClosed && (
              <Alert severity="info">Este pago ya está cerrado; no se puede editar.</Alert>
            )}
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => navigate('/admin/pagos')} disabled={busy}>Cancelar</Button>
              <Button variant="contained" onClick={save} disabled={busy || isClosed}>Guardar</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Historial</Typography>
          <EventTimeline events={p.events ?? []} createdAt={p.createdAt} />
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)}>
        <DialogTitle>Rechazar pago</DialogTitle>
        <DialogContent>
          <TextField label="Motivo (mínimo 3 caracteres)" fullWidth multiline minRows={2} sx={{ mt: 1, minWidth: 360 }}
            value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="contained" color="error"
            disabled={busy || rejectComment.trim().length < 3}
            onClick={onConfirmReject}>Rechazar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={expireOpen} onClose={() => setExpireOpen(false)}>
        <DialogTitle>Marcar como vencido</DialogTitle>
        <DialogContent>
          <Typography>¿Marcar este pago como vencido? El conductor será desactivado.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExpireOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="contained" color="warning" onClick={onConfirmExpire} disabled={busy}>Confirmar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
```

- [ ] **Paso 3: Registrar la ruta**

Editar `src/journal/routes/JournalRoutes.jsx`. Importar y agregar:

```jsx
import PaymentDetailPage from "../../admin/payments/PaymentDetailPage"
// ...
<Route path="/admin/pagos/:id" element={<PaymentDetailPage />} />
```

(Agregar antes del wildcard final.)

- [ ] **Paso 4: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero warnings, build OK.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/PaymentDetailPage.tsx src/admin/payments/EventTimeline.tsx src/journal/routes/JournalRoutes.jsx
git commit -m "feat(admin): PaymentDetailPage con edicion, historial, vencimiento individual y aprobar/rechazar"
```

---

## Task 14: Botón "Marcar vencidos" masivo + botón "Ver" en lista

**Files:**
- Modify: `tukytuk-admin/src/admin/payments/PaymentsListPage.tsx`

**Interfaces:**
- Consumes: `expireOverduePayments` (T12), `useToast()`, navegación.

- [ ] **Paso 1: Agregar imports**

En `PaymentsListPage.tsx`:

```tsx
import ScheduleIcon from '@mui/icons-material/Schedule';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate } from 'react-router-dom';
import { expireOverduePayments } from '../../api/payments';
// useToast ya está importado tras T9
```

(Si `useNavigate` ya está, no duplicar.)

- [ ] **Paso 2: Agregar state y handler**

Dentro del componente:

```tsx
const navigate = useNavigate();
const [expireOpen, setExpireOpen] = useState(false);
const [expireBusy, setExpireBusy] = useState(false);

const onConfirmExpireOverdue = async () => {
  setExpireBusy(true);
  try {
    const r = await expireOverduePayments();
    if (r.expiredCount === 0) {
      toast.info('No hay pagos para vencer');
    } else {
      toast.success(`Vencidos: ${r.expiredCount} pagos, ${r.deactivatedDrivers} conductores desactivados`);
    }
    setExpireOpen(false);
    await load();
  } catch {
    toast.error('No se pudo procesar el vencimiento');
  } finally {
    setExpireBusy(false);
  }
};
```

- [ ] **Paso 3: Agregar botón al header de acciones**

Junto a "Nuevo pago" / "Configuración" / "Precio especial", agregar:

```tsx
<Button
  variant="outlined" color="warning"
  startIcon={<ScheduleIcon />}
  onClick={() => setExpireOpen(true)}
>
  Marcar vencidos
</Button>
```

- [ ] **Paso 4: Agregar botón "Ver" a cada fila**

En la columna de acciones de la tabla, agregar al inicio del Stack:

```tsx
<Button size="small" startIcon={<VisibilityIcon />} onClick={() => navigate(`/admin/pagos/${p.uid}`)}>
  Ver
</Button>
```

- [ ] **Paso 5: Agregar el dialog**

Al final del JSX (antes del cierre del Box raíz), agregar:

```tsx
<Dialog open={expireOpen} onClose={() => setExpireOpen(false)}>
  <DialogTitle>Marcar pagos vencidos</DialogTitle>
  <DialogContent>
    <Typography>
      Esto marcará como vencidos todos los pagos aprobados cuya vigencia haya expirado
      y desactivará a los conductores afectados. ¿Continuar?
    </Typography>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setExpireOpen(false)} disabled={expireBusy}>Cancelar</Button>
    <Button
      variant="contained" color="warning"
      onClick={onConfirmExpireOverdue}
      disabled={expireBusy}
      startIcon={expireBusy ? <CircularProgress size={14} /> : undefined}
    >
      {expireBusy ? 'Procesando…' : 'Marcar vencidos'}
    </Button>
  </DialogActions>
</Dialog>
```

(Importar `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`, `Typography`, `CircularProgress` si no están.)

- [ ] **Paso 6: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

- [ ] **Paso 7: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/PaymentsListPage.tsx
git commit -m "feat(admin): boton Marcar vencidos masivo y Ver detalle en lista de pagos"
```

---

## Notas finales

- **Verificación manual del golden path** (sección 8 del spec): ejecutar después de implementar las 14 tareas.
- **Sin migración de datos.** `events: []` es default en Mongoose; documentos viejos se interpretan como "Pago creado" implícito vía `createdAt`.
- **Despliegue:** backend primero (endpoints aditivos), luego admin. Sin variables nuevas. Sin cambios en la app Flutter.
- **Limpieza opcional:** si quedan archivos huérfanos en `uploads/payments/` por el reemplazo de comprobantes que falló históricamente, ejecutar `find uploads/payments -mtime +90 -type f` en el servidor para identificarlos. Fuera del alcance de este plan.
