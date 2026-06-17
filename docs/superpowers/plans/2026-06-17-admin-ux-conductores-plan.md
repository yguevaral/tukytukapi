# UX del admin para conductores — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** Convertir el módulo de conductores del admin en un CRUD navegable con búsqueda + paginación + edición + subida de imágenes, reemplazar todos los `driverUid` crudos por un autocomplete reusable, y agregar breadcrumbs en todas las pantallas.

**Architecture:** Backend expone 5 endpoints nuevos bajo `/api/usuarios/admin/drivers` (lista paginada con `$lookup`, detalle, update con diff, upload de imagen vía multer, sirve imagen con auth). Admin gana tres componentes compartidos (`DriverAutocomplete`, `PageBreadcrumbs`, `DriverImagePicker`) que se reusan en dos pantallas nuevas (`DriversListPage`, `DriverDetailPage`) y en las cuatro existentes de pagos. La pantalla legacy `PendingDriversPage` se elimina; su funcionalidad se absorbe en el listado con filtro de status.

**Tech Stack:**
- Backend: Node.js + Express + Mongoose + Socket.IO + multer. Tests con `node:test`.
- Admin: React 18 + TS + Vite + MUI + axios (vía `apiClient`).

## Global Constraints

- Idioma: comentarios y commits en español. Strings de UI en español.
- Convenciones backend: respuestas `{ ok: boolean, msg: string, ... }`. Tests `node:test` + `node:assert/strict`. Conventional commits en español. Sin Co-author. Sin `--no-verify`. `git add` por nombre.
- `Driver.status` enum: `'A'` aprobado, `'R'` rechazado, `'P'` pendiente.
- `Usuario.type === 'C'` distingue conductores; el admin tiene `type === 'A'`.
- Upload (mismo que Spec 2): límite 5 MB, mimetypes `['image/jpeg', 'image/png', 'image/webp']`. Filename regex `/^[a-zA-Z0-9._-]+$/`.
- Path traversal: tras `path.resolve(...)` verificar que el resultado siga dentro de `uploads/drivers/`.
- Convención admin: TypeScript estricto sin `any` implícito (`apiClient.get<T>`). `npm run lint --max-warnings 0` y `npm run build` deben pasar. Comentarios en español.
- Rutas admin con prefijo `/admin/`. Sidebar muestra solo "Conductores" en vez de "Conductores pendientes" + "Crear conductor".
- No tocar bugs preexistentes (ej. `controllers/trip.js:44`, `:159`).

---

## Estructura de archivos a tocar

**Backend (`tukytukapi/`):**
- Modificar: `models/driver.js` (índices nuevos).
- Crear: `helpers/upload-drivers.js` (multer hacia `uploads/drivers/`).
- Modificar: `controllers/usuarios.js` (5 handlers nuevos: `adminListDrivers`, `adminGetDriver`, `adminUpdateDriver`, `adminUploadDriverImage`, `serveDriverImage`).
- Modificar: `routes/usuarios.js` (5 rutas nuevas + actualizar imports y `param` validator).
- Modificar: `.gitignore` (asegurar `uploads/` incluido).
- Tests: `tests/admin-drivers-list.test.js`, `tests/admin-driver-detail.test.js`, `tests/admin-driver-update.test.js`, `tests/admin-driver-image.test.js`.

**Admin (`tukytuk-admin/`):**
- Modificar: `src/api/drivers.ts` (agregar interfaces y funciones nuevas).
- Crear: `src/components/PageBreadcrumbs.tsx`.
- Crear: `src/components/DriverAutocomplete.tsx`.
- Crear: `src/components/DriverImagePicker.tsx`.
- Crear: `src/admin/drivers/DriversListPage.tsx`.
- Crear: `src/admin/drivers/DriverDetailPage.tsx`.
- Modificar: `src/admin/payments/PaymentsListPage.tsx` (Autocomplete + Breadcrumb + lectura de `?driverUid=`).
- Modificar: `src/admin/payments/CreateManualPaymentPage.tsx` (Autocomplete + Breadcrumb).
- Modificar: `src/admin/payments/PaymentSettingsPage.tsx` (Breadcrumb).
- Modificar: `src/admin/payments/SpecialPricingPage.tsx` (Autocomplete + Breadcrumb).
- Modificar: `src/admin/drivers/CreateDriverPage.tsx` (Breadcrumb).
- Modificar: `src/journal/routes/JournalRoutes.jsx` (rutas + redirect de `/admin/drivers/pending`).
- Modificar: `src/admin/layout/AdminSidebar.tsx` (NAV_ITEMS).
- Eliminar: `src/admin/drivers/PendingDriversPage.tsx`.

---

## Task 1: Índices en el modelo Driver

**Files:**
- Modify: `tukytukapi/models/driver.js`
- Test: `tukytukapi/tests/admin-drivers-list.test.js` (crear vacío con un test placeholder; se llena en T2)

**Interfaces:**
- Produces: índices `{ plate: 1 }` y `{ status: 1, usuario: 1 }` sobre `Driver`. Los queries de Task 2 (búsqueda por placa y filtro por status) los aprovechan.

- [ ] **Paso 1: Agregar los dos índices al schema**

Editar `tukytukapi/models/driver.js`. Después del `}, { timestamps: true });` y antes del `DriverSchema.method('toJSON', ...)`:

```js
DriverSchema.index({ plate: 1 });
DriverSchema.index({ status: 1, usuario: 1 });
```

- [ ] **Paso 2: Verificar que la suite existente sigue pasando**

```bash
cd tukytukapi
npm test
```

Esperado: todos los tests del Spec 1 y Spec 2 siguen pasando (Mongoose crea los índices al cargar el schema, sin migrarción de datos).

- [ ] **Paso 3: Commit**

```bash
cd tukytukapi
git add models/driver.js
git commit -m "feat(backend): indices en Driver para busqueda por placa y filtro status"
```

---

## Task 2: Endpoint GET /admin/drivers (lista paginada con búsqueda)

**Files:**
- Modify: `tukytukapi/controllers/usuarios.js` (agregar `adminListDrivers`)
- Modify: `tukytukapi/routes/usuarios.js` (agregar ruta)
- Test: `tukytukapi/tests/admin-drivers-list.test.js` (crear)

**Interfaces:**
- Consumes: índices de Task 1.
- Produces: handler `adminListDrivers(req, res)`; ruta `GET /api/usuarios/admin/drivers?status&search&page&limit`. Devuelve `{ ok, drivers: [{driver, usuario}], total, page, limit }`. Mismo endpoint sirve al autocomplete del admin (Task 9).

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/admin-drivers-list.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Driver = require('../models/driver');
const { adminListDrivers } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminListDrivers sin filtros usa defaults (page=1, limit=20)', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: {} };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 20);
    assert.equal(res.body.total, 0);
});

test('adminListDrivers filtra por status', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: { status: 'A' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    // Encuentra el stage de $match con status
    const statusMatch = captured.find(s => s.$match && s.$match.status === 'A');
    assert.ok(statusMatch, 'debería incluir $match por status');
});

test('adminListDrivers filtra por search con regex en multiples campos', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    let captured;
    Driver.aggregate = async (pipeline) => {
        captured = pipeline;
        return [{ drivers: [], meta: [] }];
    };

    const req = { uid: 'a1', query: { search: 'juan' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    const searchMatch = captured.find(s => s.$match && s.$match.$or);
    assert.ok(searchMatch);
    const fields = searchMatch.$match.$or.map(c => Object.keys(c)[0]);
    assert.ok(fields.includes('usuario.nombre'));
    assert.ok(fields.includes('usuario.apellido'));
    assert.ok(fields.includes('usuario.email'));
    assert.ok(fields.includes('plate'));
});

test('adminListDrivers limita limit a 100 maximo', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    Driver.aggregate = async () => [{ drivers: [], meta: [] }];

    const req = { uid: 'a1', query: { limit: '500' } };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.body.limit, 100);
});

test('adminListDrivers transforma el shape a {driver, usuario}', async (t) => {
    const original = Driver.aggregate;
    t.after(() => { Driver.aggregate = original; });

    Driver.aggregate = async () => [{
        drivers: [{
            _id: 'd1', plate: 'P-1', status: 'A',
            usuario: { _id: 'u1', nombre: 'Juan', email: 'j@x.com' }
        }],
        meta: [{ total: 1 }]
    }];

    const req = { uid: 'a1', query: {} };
    const res = makeRes();
    await adminListDrivers(req, res);
    assert.equal(res.body.drivers.length, 1);
    assert.equal(res.body.drivers[0].driver.plate, 'P-1');
    assert.equal(res.body.drivers[0].usuario.nombre, 'Juan');
    assert.equal(res.body.total, 1);
});
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

```bash
cd tukytukapi
node --test tests/admin-drivers-list.test.js
```

Esperado: falla con `adminListDrivers is not a function`.

- [ ] **Paso 3: Implementar el handler**

Editar `tukytukapi/controllers/usuarios.js`. Agregar antes del `module.exports`:

```js
const adminListDrivers = async (req, res = response) => {
    try {
        const { status, search } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);

        const pipeline = [
            { $lookup: { from: 'usuarios', localField: 'usuario', foreignField: '_id', as: 'usuario' } },
            { $unwind: '$usuario' }
        ];

        if (status && ['A', 'R', 'P'].includes(status)) {
            pipeline.push({ $match: { status } });
        }

        if (search && typeof search === 'string' && search.trim()) {
            const regex = { $regex: search.trim(), $options: 'i' };
            pipeline.push({
                $match: {
                    $or: [
                        { 'usuario.nombre': regex },
                        { 'usuario.apellido': regex },
                        { 'usuario.email': regex },
                        { plate: regex }
                    ]
                }
            });
        }

        pipeline.push({
            $facet: {
                drivers: [
                    { $sort: { createdAt: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit }
                ],
                meta: [{ $count: 'total' }]
            }
        });

        const result = await Driver.aggregate(pipeline);
        const rows = result[0]?.drivers ?? [];
        const total = result[0]?.meta?.[0]?.total ?? 0;

        const drivers = rows.map((row) => {
            const { usuario, _id, ...rest } = row;
            return {
                driver: { uid: _id, ...rest },
                usuario: { uid: usuario._id, nombre: usuario.nombre, apellido: usuario.apellido, email: usuario.email, telefono: usuario.telefono }
            };
        });

        return res.status(200).json({ ok: true, drivers, total, page, limit });
    } catch (err) {
        console.error('adminListDrivers', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar `adminListDrivers` al `module.exports`.

- [ ] **Paso 4: Correr el test y confirmar que pasa**

```bash
cd tukytukapi
node --test tests/admin-drivers-list.test.js
```

Esperado: 5 tests pasan.

- [ ] **Paso 5: Agregar la ruta**

Editar `tukytukapi/routes/usuarios.js`. Importar `adminListDrivers` del controllers/usuarios destructuring. Después de la ruta existente de `/driver/admin-create` agregar:

```js
router.get('/admin/drivers', [validarJWT, validarAdmin], adminListDrivers);
```

- [ ] **Paso 6: Suite completa**

```bash
cd tukytukapi
npm test
```

Esperado: todo pasa.

- [ ] **Paso 7: Commit**

```bash
cd tukytukapi
git add controllers/usuarios.js routes/usuarios.js tests/admin-drivers-list.test.js
git commit -m "feat(backend): endpoint admin GET /usuarios/admin/drivers con busqueda paginada"
```

---

## Task 3: Endpoint GET /admin/drivers/:uid (detalle)

**Files:**
- Modify: `tukytukapi/controllers/usuarios.js` (`adminGetDriver`)
- Modify: `tukytukapi/routes/usuarios.js`
- Test: `tukytukapi/tests/admin-driver-detail.test.js` (crear)

**Interfaces:**
- Produces: `adminGetDriver(req, res)`; ruta `GET /api/usuarios/admin/drivers/:uid`. Devuelve `{ ok, usuario, driver }`. `driver` puede ser `null` si el usuario no completó onboarding.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/admin-driver-detail.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { adminGetDriver } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminGetDriver 404 si usuario no existe', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => null;

    const req = { uid: 'a1', params: { uid: 'x' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetDriver 404 si type no es C', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => ({ type: 'U' });

    const req = { uid: 'a1', params: { uid: 'x' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminGetDriver 200 con usuario y driver', async (t) => {
    const origU = Usuario.findById;
    const origD = Driver.findOne;
    t.after(() => { Usuario.findById = origU; Driver.findOne = origD; });

    Usuario.findById = async () => ({ type: 'C', nombre: 'Juan' });
    Driver.findOne = async () => ({ plate: 'P-1', status: 'A' });

    const req = { uid: 'a1', params: { uid: 'u1' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.usuario.nombre, 'Juan');
    assert.equal(res.body.driver.plate, 'P-1');
});

test('adminGetDriver devuelve driver=null si no existe Driver row', async (t) => {
    const origU = Usuario.findById;
    const origD = Driver.findOne;
    t.after(() => { Usuario.findById = origU; Driver.findOne = origD; });

    Usuario.findById = async () => ({ type: 'C', nombre: 'Pedro' });
    Driver.findOne = async () => null;

    const req = { uid: 'a1', params: { uid: 'u1' } };
    const res = makeRes();
    await adminGetDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.driver, null);
});
```

- [ ] **Paso 2: Correr el test (falla)**

```bash
cd tukytukapi
node --test tests/admin-driver-detail.test.js
```

- [ ] **Paso 3: Implementar el handler**

En `controllers/usuarios.js` agregar:

```js
const adminGetDriver = async (req, res = response) => {
    try {
        const { uid } = req.params;
        const usuario = await Usuario.findById(uid);
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        const driver = await Driver.findOne({ usuario: uid });
        return res.status(200).json({ ok: true, usuario, driver });
    } catch (err) {
        console.error('adminGetDriver', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 4: Agregar la ruta**

En `routes/usuarios.js`, importar y agregar:

```js
router.get('/admin/drivers/:uid', [validarJWT, validarAdmin], adminGetDriver);
```

- [ ] **Paso 5: Tests y commit**

```bash
cd tukytukapi
node --test tests/admin-driver-detail.test.js
npm test
git add controllers/usuarios.js routes/usuarios.js tests/admin-driver-detail.test.js
git commit -m "feat(backend): endpoint admin GET /usuarios/admin/drivers/:uid (detalle)"
```

---

## Task 4: Endpoint PUT /admin/drivers/:uid (update + validación email duplicado)

**Files:**
- Modify: `tukytukapi/controllers/usuarios.js` (`adminUpdateDriver`)
- Modify: `tukytukapi/routes/usuarios.js`
- Test: `tukytukapi/tests/admin-driver-update.test.js` (crear)

**Interfaces:**
- Produces: `adminUpdateDriver(req, res)`; ruta `PUT /api/usuarios/admin/drivers/:uid`. Body con subset de `{nombre, apellido, email, telefono, plate, locallicense, address, status, commentsAdmin}`. Devuelve `{ ok, usuario, driver }`. 409 con `msg: 'email_duplicado'` si el nuevo email choca con otro Usuario.

- [ ] **Paso 1: Crear el test**

Crear `tukytukapi/tests/admin-driver-update.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Usuario = require('../models/usuario');
const Driver = require('../models/driver');
const { adminUpdateDriver } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminUpdateDriver 404 si usuario no existe', async (t) => {
    const orig = Usuario.findById;
    t.after(() => { Usuario.findById = orig; });
    Usuario.findById = async () => null;

    const req = { uid: 'a1', params: { uid: 'x' }, body: {} };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminUpdateDriver 409 si nuevo email choca', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    t.after(() => { Usuario.findById = origFindById; Usuario.findOne = origFindOne; });

    const targetId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    Usuario.findById = async () => ({
        _id: targetId, type: 'C', email: 'old@x.com',
        save: async function() { return this; }
    });
    Usuario.findOne = async () => ({ _id: otherId, email: 'nuevo@x.com' });

    const req = { uid: 'a1', params: { uid: String(targetId) }, body: { email: 'nuevo@x.com' } };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.msg, 'email_duplicado');
});

test('adminUpdateDriver 200 actualiza solo campos enviados', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    const origDriverFindOne = Driver.findOne;
    t.after(() => {
        Usuario.findById = origFindById;
        Usuario.findOne = origFindOne;
        Driver.findOne = origDriverFindOne;
    });

    const usuarioDoc = {
        _id: new mongoose.Types.ObjectId(),
        type: 'C', email: 'old@x.com', nombre: 'Juan', telefono: '',
        save: async function() { return this; }
    };
    Usuario.findById = async () => usuarioDoc;
    Usuario.findOne = async () => null;
    const driverDoc = {
        plate: 'P-1', status: 'P', address: 'X',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = {
        uid: 'a1',
        params: { uid: String(usuarioDoc._id) },
        body: { telefono: '555-1234', status: 'A' }
    };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(usuarioDoc.telefono, '555-1234');
    assert.equal(usuarioDoc.nombre, 'Juan'); // sin cambio
    assert.equal(driverDoc.status, 'A');
    assert.equal(driverDoc.plate, 'P-1'); // sin cambio
});

test('adminUpdateDriver permite cambiar email a mismo usuario sin 409', async (t) => {
    const origFindById = Usuario.findById;
    const origFindOne = Usuario.findOne;
    t.after(() => { Usuario.findById = origFindById; Usuario.findOne = origFindOne; });

    const targetId = new mongoose.Types.ObjectId();
    const usuarioDoc = {
        _id: targetId, type: 'C', email: 'old@x.com',
        save: async function() { return this; }
    };
    Usuario.findById = async () => usuarioDoc;
    // findOne devuelve el mismo usuario (caso de no cambiar pero pasar el mismo email)
    Usuario.findOne = async () => ({ _id: targetId, email: 'old@x.com' });

    const req = { uid: 'a1', params: { uid: String(targetId) }, body: { email: 'old@x.com' } };
    const res = makeRes();
    await adminUpdateDriver(req, res);
    assert.equal(res.statusCode, 200);
});
```

- [ ] **Paso 2: Correr el test (falla)**

```bash
cd tukytukapi
node --test tests/admin-driver-update.test.js
```

- [ ] **Paso 3: Implementar el handler**

En `controllers/usuarios.js`:

```js
const adminUpdateDriver = async (req, res = response) => {
    try {
        const { uid } = req.params;
        const usuario = await Usuario.findById(uid);
        if (!usuario || usuario.type !== 'C') {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }

        const userFields = ['nombre', 'apellido', 'email', 'telefono'];
        const userUpdate = {};
        for (const f of userFields) {
            if (req.body[f] !== undefined) userUpdate[f] = req.body[f];
        }

        if (userUpdate.email !== undefined && userUpdate.email !== usuario.email) {
            const existing = await Usuario.findOne({ email: userUpdate.email });
            if (existing && String(existing._id) !== String(usuario._id)) {
                return res.status(409).json({ ok: false, msg: 'email_duplicado' });
            }
        }

        for (const k of Object.keys(userUpdate)) usuario[k] = userUpdate[k];
        if (Object.keys(userUpdate).length) await usuario.save();

        const driverFields = ['plate', 'locallicense', 'address', 'status', 'commentsAdmin'];
        const driverUpdate = {};
        for (const f of driverFields) {
            if (req.body[f] !== undefined) driverUpdate[f] = req.body[f];
        }

        const driver = await Driver.findOne({ usuario: uid });
        if (driver && Object.keys(driverUpdate).length) {
            for (const k of Object.keys(driverUpdate)) driver[k] = driverUpdate[k];
            await driver.save();
        }

        return res.status(200).json({ ok: true, usuario, driver });
    } catch (err) {
        console.error('adminUpdateDriver', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 4: Agregar la ruta con validaciones**

En `routes/usuarios.js`, importar `check` (ya importado), agregar:

```js
router.put('/admin/drivers/:uid', [
    validarJWT,
    validarAdmin,
    check('email').optional().isEmail().withMessage('email inválido'),
    check('status').optional().isIn(['A', 'R', 'P']).withMessage('status inválido'),
    validarCampos
], adminUpdateDriver);
```

- [ ] **Paso 5: Tests y commit**

```bash
cd tukytukapi
node --test tests/admin-driver-update.test.js
npm test
git add controllers/usuarios.js routes/usuarios.js tests/admin-driver-update.test.js
git commit -m "feat(backend): endpoint admin PUT /usuarios/admin/drivers/:uid con validacion email duplicado"
```

---

## Task 5: Upload de imágenes (multer + endpoint)

**Files:**
- Create: `tukytukapi/helpers/upload-drivers.js`
- Modify: `tukytukapi/controllers/usuarios.js` (`adminUploadDriverImage`)
- Modify: `tukytukapi/routes/usuarios.js`
- Modify: `tukytukapi/.gitignore` (verificar `uploads/`)
- Test: `tukytukapi/tests/admin-driver-image.test.js` (crear)

**Interfaces:**
- Consumes: `multer` (ya instalado en Spec 2).
- Produces:
  - `helpers/upload-drivers.js` exporta una instancia de multer configurada con destino `uploads/drivers/`, 5MB y mimetypes jpeg/png/webp.
  - `adminUploadDriverImage(req, res)` handler; ruta `POST /api/usuarios/admin/drivers/:uid/imagen` con `multipart/form-data` (campo `imagen` + body `tipo`). Devuelve `{ ok, driver }`.

- [ ] **Paso 1: Crear `helpers/upload-drivers.js`**

Crear `tukytukapi/helpers/upload-drivers.js`:

```js
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

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
    limits: { fileSize: 5 * 1024 * 1024 }
});
```

- [ ] **Paso 2: Crear carpeta y verificar `.gitignore`**

```bash
cd tukytukapi
mkdir -p uploads/drivers
grep -q '^uploads/' .gitignore || echo 'uploads/' >> .gitignore
```

- [ ] **Paso 3: Crear el test del handler**

Crear `tukytukapi/tests/admin-driver-image.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Driver = require('../models/driver');
const { adminUploadDriverImage } = require('../controllers/usuarios');

const makeRes = () => ({
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('adminUploadDriverImage 400 si tipo invalido', async () => {
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'mal' }, file: { filename: 'x.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminUploadDriverImage 400 si no hay archivo', async () => {
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: null };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('adminUploadDriverImage 404 si driver no existe', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    Driver.findOne = async () => null;

    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: { filename: 'x.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 404);
});

test('adminUploadDriverImage 200 setea imageProfile cuando tipo=perfil', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });

    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;

    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'perfil' }, file: { filename: '123-abc.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(driverDoc.imageProfile, '/api/usuarios/admin/drivers/imagen/123-abc.jpg');
    assert.equal(driverDoc.imageDPI1, '');
});

test('adminUploadDriverImage 200 setea imageDPI1 cuando tipo=dpi1', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'dpi1' }, file: { filename: 'd1.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(driverDoc.imageDPI1, '/api/usuarios/admin/drivers/imagen/d1.jpg');
});

test('adminUploadDriverImage 200 setea imageDPI2 cuando tipo=dpi2', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    const driverDoc = {
        imageProfile: '', imageDPI1: '', imageDPI2: '',
        save: async function() { return this; }
    };
    Driver.findOne = async () => driverDoc;
    const req = { uid: 'a1', params: { uid: 'u1' }, body: { tipo: 'dpi2' }, file: { filename: 'd2.jpg' } };
    const res = makeRes();
    await adminUploadDriverImage(req, res);
    assert.equal(driverDoc.imageDPI2, '/api/usuarios/admin/drivers/imagen/d2.jpg');
});
```

- [ ] **Paso 4: Correr el test (falla)**

```bash
cd tukytukapi
node --test tests/admin-driver-image.test.js
```

- [ ] **Paso 5: Implementar el handler**

En `controllers/usuarios.js`:

```js
const adminUploadDriverImage = async (req, res = response) => {
    try {
        const { uid } = req.params;
        const { tipo } = req.body || {};
        const fieldMap = { perfil: 'imageProfile', dpi1: 'imageDPI1', dpi2: 'imageDPI2' };
        if (!fieldMap[tipo]) {
            return res.status(400).json({ ok: false, msg: 'tipo inválido (perfil|dpi1|dpi2)' });
        }
        if (!req.file) {
            return res.status(400).json({ ok: false, msg: 'Falta la imagen' });
        }
        const driver = await Driver.findOne({ usuario: uid });
        if (!driver) {
            return res.status(404).json({ ok: false, msg: 'Conductor no encontrado' });
        }
        driver[fieldMap[tipo]] = `/api/usuarios/admin/drivers/imagen/${req.file.filename}`;
        await driver.save();
        return res.status(200).json({ ok: true, driver });
    } catch (err) {
        console.error('adminUploadDriverImage', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 6: Agregar la ruta**

En `routes/usuarios.js`:

```js
const uploadDrivers = require('../helpers/upload-drivers');
// ...
router.post('/admin/drivers/:uid/imagen',
    [validarJWT, validarAdmin, uploadDrivers.single('imagen')],
    adminUploadDriverImage
);
```

- [ ] **Paso 7: Tests y commit**

```bash
cd tukytukapi
node --test tests/admin-driver-image.test.js
npm test
git add helpers/upload-drivers.js controllers/usuarios.js routes/usuarios.js tests/admin-driver-image.test.js .gitignore
git commit -m "feat(backend): upload de imagenes de conductor (perfil/DPI) con multer"
```

---

## Task 6: Servir imágenes con auth (GET /admin/drivers/imagen/:filename)

**Files:**
- Modify: `tukytukapi/controllers/usuarios.js` (`serveDriverImage`)
- Modify: `tukytukapi/routes/usuarios.js`
- Test: agregar a `tukytukapi/tests/admin-driver-image.test.js`

**Interfaces:**
- Produces: `serveDriverImage(req, res)`; ruta `GET /api/usuarios/admin/drivers/imagen/:filename`. Sirve binario imagen. Autoriza dueño o admin. Path-traversal hardening con regex + `path.resolve` + verificación de prefijo.

- [ ] **Paso 1: Extender el test de imágenes**

Editar `tukytukapi/tests/admin-driver-image.test.js`, agregar al final:

```js
const Usuario = require('../models/usuario');
const { serveDriverImage } = require('../controllers/usuarios');

const makeFileRes = () => ({
    statusCode: 200, body: null, sentFile: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    sendFile(p) { this.sentFile = p; return this; }
});

test('serveDriverImage 400 si filename inválido', async () => {
    const req = { uid: 'u1', params: { filename: '../etc/passwd' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 400);
});

test('serveDriverImage 404 si no encuentra driver con esa URL', async (t) => {
    const orig = Driver.findOne;
    t.after(() => { Driver.findOne = orig; });
    Driver.findOne = async () => null;

    const req = { uid: 'u1', params: { filename: 'noexiste.jpg' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 404);
});

test('serveDriverImage 403 si no es dueño ni admin', async (t) => {
    const origD = Driver.findOne;
    const origU = Usuario.findById;
    t.after(() => { Driver.findOne = origD; Usuario.findById = origU; });

    Driver.findOne = async () => ({ usuario: 'owner-uid' });
    Usuario.findById = () => ({ select: async () => ({ type: 'U' }) });

    const req = { uid: 'otro-uid', params: { filename: 'x.jpg' } };
    const res = makeFileRes();
    await serveDriverImage(req, res);
    assert.equal(res.statusCode, 403);
});
```

- [ ] **Paso 2: Correr el test (falla)**

```bash
cd tukytukapi
node --test tests/admin-driver-image.test.js
```

- [ ] **Paso 3: Implementar el handler**

En `controllers/usuarios.js`, agregar al inicio (junto a otros requires):

```js
const path = require('path');
const fs = require('fs');
```

(Si ya están de otra parte, omitir.)

Handler:

```js
const serveDriverImage = async (req, res = response) => {
    try {
        const { filename } = req.params;
        if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
            return res.status(400).json({ ok: false, msg: 'Nombre de archivo inválido' });
        }
        const url = `/api/usuarios/admin/drivers/imagen/${filename}`;
        const driver = await Driver.findOne({
            $or: [
                { imageProfile: url },
                { imageDPI1: url },
                { imageDPI2: url }
            ]
        });
        if (!driver) {
            return res.status(404).json({ ok: false, msg: 'Imagen no encontrada' });
        }
        const isOwner = String(driver.usuario) === String(req.uid);
        if (!isOwner) {
            const usuario = await Usuario.findById(req.uid).select('type');
            if (!usuario || usuario.type !== 'A') {
                return res.status(403).json({ ok: false, msg: 'No autorizado' });
            }
        }
        const baseDir = path.resolve('uploads/drivers');
        const filePath = path.resolve(baseDir, filename);
        if (!filePath.startsWith(baseDir + path.sep)) {
            return res.status(400).json({ ok: false, msg: 'Ruta inválida' });
        }
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ ok: false, msg: 'Archivo no encontrado' });
        }
        return res.sendFile(filePath);
    } catch (err) {
        console.error('serveDriverImage', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Agregar al `module.exports`.

- [ ] **Paso 4: Agregar la ruta**

En `routes/usuarios.js`:

```js
router.get('/admin/drivers/imagen/:filename', [validarJWT], serveDriverImage);
```

(Solo `validarJWT`; el chequeo de admin/dueño vive en el handler.)

- [ ] **Paso 5: Tests y commit**

```bash
cd tukytukapi
node --test tests/admin-driver-image.test.js
npm test
git add controllers/usuarios.js routes/usuarios.js tests/admin-driver-image.test.js
git commit -m "feat(backend): servir imagenes de conductor con auth y path traversal hardening"
```

---

## Task 7: Cliente API admin extendido

**Files:**
- Modify: `tukytuk-admin/src/api/drivers.ts` (agregar interfaces y funciones nuevas)

**Interfaces:**
- Consumes: endpoints de Tasks 2-6.
- Produces (todas tipadas con genéricos sobre `apiClient`):
  - `DriverWithUser` y `DriversListResult` interfaces.
  - `listDrivers(filters?, signal?) → Promise<DriversListResult>`.
  - `getDriver(uid) → Promise<DriverWithUser>`.
  - `updateDriver(uid, partial) → Promise<DriverWithUser>`.
  - `uploadDriverImage(uid, tipo, file) → Promise<DriverWithUser>`.

- [ ] **Paso 1: Editar `src/api/drivers.ts`**

Al final del archivo (después de las funciones existentes):

```ts
export interface DriverData {
  uid: string;
  plate: string;
  locallicense: string;
  address: string;
  imageProfile: string;
  imageDPI1: string;
  imageDPI2: string;
  status: 'A' | 'R' | 'P';
  commentsAdmin?: string;
  specialPrice?: number;
  specialDurationDays?: number;
}

export interface UsuarioData {
  uid: string;
  nombre: string;
  apellido?: string;
  email: string;
  telefono?: string;
}

export interface DriverWithUser {
  driver: DriverData;
  usuario: UsuarioData;
}

export interface DriversListFilters {
  status?: 'A' | 'R' | 'P';
  search?: string;
  page?: number;
  limit?: number;
}

export interface DriversListResult {
  drivers: DriverWithUser[];
  total: number;
  page: number;
  limit: number;
}

export async function listDrivers(
  filters: DriversListFilters = {},
  signal?: AbortSignal
): Promise<DriversListResult> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const url = `/usuarios/admin/drivers${params.toString() ? '?' + params.toString() : ''}`;
  const res = await apiClient.get<{
    ok: boolean;
    drivers: DriverWithUser[];
    total: number;
    page: number;
    limit: number;
  }>(url, { signal });
  return {
    drivers: res.data.drivers,
    total: res.data.total,
    page: res.data.page,
    limit: res.data.limit
  };
}

export async function getDriver(uid: string): Promise<DriverWithUser> {
  const res = await apiClient.get<{ ok: boolean; usuario: UsuarioData; driver: DriverData | null }>(
    `/usuarios/admin/drivers/${uid}`
  );
  return { usuario: res.data.usuario, driver: res.data.driver as DriverData };
}

export interface UpdateDriverPayload {
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  plate?: string;
  locallicense?: string;
  address?: string;
  status?: 'A' | 'R' | 'P';
  commentsAdmin?: string;
}

export async function updateDriver(uid: string, payload: UpdateDriverPayload): Promise<DriverWithUser> {
  const res = await apiClient.put<{ ok: boolean; usuario: UsuarioData; driver: DriverData }>(
    `/usuarios/admin/drivers/${uid}`,
    payload
  );
  return { usuario: res.data.usuario, driver: res.data.driver };
}

export async function uploadDriverImage(
  uid: string,
  tipo: 'perfil' | 'dpi1' | 'dpi2',
  file: File
): Promise<DriverData> {
  const form = new FormData();
  form.append('tipo', tipo);
  form.append('imagen', file);
  const res = await apiClient.post<{ ok: boolean; driver: DriverData }>(
    `/usuarios/admin/drivers/${uid}/imagen`,
    form
  );
  return res.data.driver;
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

Esperado: cero warnings.

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/api/drivers.ts
git commit -m "feat(admin): api client extendido con list/get/update/uploadImage de conductores"
```

---

## Task 8: Componente `<PageBreadcrumbs>`

**Files:**
- Create: `tukytuk-admin/src/components/PageBreadcrumbs.tsx`

**Interfaces:**
- Produces: componente con props `{ items: BreadcrumbItem[]; backTo?: string }`. Usado en T11-T14.

- [ ] **Paso 1: Crear el componente**

Crear `tukytuk-admin/src/components/PageBreadcrumbs.tsx`:

```tsx
import { Box, Breadcrumbs, IconButton, Link, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface Props {
  items: BreadcrumbItem[];
  backTo?: string;
}

export function PageBreadcrumbs({ items, backTo }: Props) {
  const navigate = useNavigate();

  if (items.length <= 1) return null;

  const target = backTo ?? items[items.length - 2]?.to;

  const onBack = () => {
    if (target) navigate(target);
    else navigate(-1);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <IconButton onClick={onBack} size="small" aria-label="Regresar">
        <ArrowBackIcon fontSize="small" />
      </IconButton>
      <Breadcrumbs separator="›">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          if (last || !item.to) {
            return (
              <Typography key={i} color="text.primary" variant="body2">
                {item.label}
              </Typography>
            );
          }
          return (
            <Link
              key={i}
              component={RouterLink}
              to={item.to}
              underline="hover"
              color="inherit"
              variant="body2"
            >
              {item.label}
            </Link>
          );
        })}
      </Breadcrumbs>
    </Box>
  );
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/components/PageBreadcrumbs.tsx
git commit -m "feat(admin): componente PageBreadcrumbs con flecha de regreso"
```

---

## Task 9: Componente `<DriverAutocomplete>`

**Files:**
- Create: `tukytuk-admin/src/components/DriverAutocomplete.tsx`

**Interfaces:**
- Consumes: `listDrivers` de Task 7.
- Produces: componente con props `{ value: string | null; onChange: (uid: string | null, label: string) => void; label?: string; required?: boolean; disabled?: boolean; helperText?: string; initialLabel?: string }`. Usado en T13.

- [ ] **Paso 1: Crear el componente**

Crear `tukytuk-admin/src/components/DriverAutocomplete.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, TextField, CircularProgress } from '@mui/material';
import { listDrivers, type DriverWithUser } from '../api/drivers';

interface Option {
  uid: string;
  label: string;
}

interface Props {
  value: string | null;
  onChange: (uid: string | null, label: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  initialLabel?: string;
}

function formatOption(d: DriverWithUser): Option {
  const fullName = `${d.usuario.nombre}${d.usuario.apellido ? ' ' + d.usuario.apellido : ''}`;
  return {
    uid: d.usuario.uid,
    label: `${fullName} — ${d.driver?.plate ?? 's/placa'} — ${d.usuario.email}`
  };
}

export function DriverAutocomplete({
  value,
  onChange,
  label = 'Conductor',
  required,
  disabled,
  helperText,
  initialLabel
}: Props) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  const selected = useMemo<Option | null>(() => {
    if (!value) return null;
    const found = options.find((o) => o.uid === value);
    if (found) return found;
    if (initialLabel) return { uid: value, label: initialLabel };
    return { uid: value, label: value };
  }, [value, options, initialLabel]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!input.trim()) {
      setOptions([]);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const result = await listDrivers({ search: input.trim(), limit: 10 }, ctrl.signal);
        setOptions(result.drivers.map(formatOption));
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [input]);

  return (
    <Autocomplete
      value={selected}
      onChange={(_e, opt) => onChange(opt?.uid ?? null, opt?.label ?? '')}
      onInputChange={(_e, v) => setInput(v)}
      options={options}
      isOptionEqualToValue={(a, b) => a.uid === b.uid}
      getOptionLabel={(o) => o.label}
      loading={loading}
      disabled={disabled}
      filterOptions={(x) => x}
      noOptionsText={input.trim() ? 'Sin coincidencias' : 'Escribe para buscar…'}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          helperText={helperText}
          placeholder="Buscar por nombre, email o placa…"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            )
          }}
        />
      )}
    />
  );
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

Esperado: cero warnings.

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/components/DriverAutocomplete.tsx
git commit -m "feat(admin): componente DriverAutocomplete con debounce y AbortController"
```

---

## Task 10: Componente `<DriverImagePicker>`

**Files:**
- Create: `tukytuk-admin/src/components/DriverImagePicker.tsx`

**Interfaces:**
- Consumes: `uploadDriverImage` de Task 7, `<AuthImage>` ya existente del Spec 2.
- Produces: componente con props `{ driverUid: string; tipo: 'perfil'|'dpi1'|'dpi2'; currentUrl?: string; label: string; onUploaded: (newUrl: string) => void }`. Usado en T12.

- [ ] **Paso 1: Crear el componente**

Crear `tukytuk-admin/src/components/DriverImagePicker.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Box, Button, CircularProgress, Typography, Snackbar, Alert } from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import { AuthImage } from './AuthImage';
import { uploadDriverImage } from '../api/drivers';

interface Props {
  driverUid: string;
  tipo: 'perfil' | 'dpi1' | 'dpi2';
  currentUrl?: string;
  label: string;
  onUploaded: (newUrl: string) => void;
}

export function DriverImagePicker({ driverUid, tipo, currentUrl, label, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy(true);
    try {
      const driver = await uploadDriverImage(driverUid, tipo, file);
      const map = { perfil: 'imageProfile', dpi1: 'imageDPI1', dpi2: 'imageDPI2' } as const;
      const newUrl = driver[map[tipo]];
      onUploaded(newUrl);
      setSnack({ kind: 'ok', text: 'Imagen actualizada' });
    } catch {
      setSnack({ kind: 'err', text: 'No se pudo subir la imagen' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box
        sx={{
          width: 180, height: 240,
          border: '1px solid #e4e7ec',
          borderRadius: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', bgcolor: '#fafafa'
        }}
      >
        {currentUrl ? (
          <AuthImage receiptUrl={currentUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <ImageIcon sx={{ fontSize: 64, color: '#cbd5e1' }} />
        )}
      </Box>
      <input
        ref={inputRef} type="file" hidden
        accept="image/jpeg,image/png,image/webp"
        onChange={onChange}
      />
      <Button
        variant="outlined" size="small"
        disabled={busy}
        onClick={onPick}
        startIcon={busy ? <CircularProgress size={14} /> : undefined}
      >
        {busy ? 'Subiendo…' : currentUrl ? 'Reemplazar' : 'Subir'}
      </Button>
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.kind === 'ok' ? 'success' : 'error'}>{snack.text}</Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/components/DriverImagePicker.tsx
git commit -m "feat(admin): componente DriverImagePicker con AuthImage y subida multipart"
```

---

## Task 11: `DriversListPage`

**Files:**
- Create: `tukytuk-admin/src/admin/drivers/DriversListPage.tsx`

**Interfaces:**
- Consumes: `listDrivers`, `setDriverStatus` (ya existe), `<PageBreadcrumbs>`.
- Produces: pantalla con tabla paginada + chips de status + search. Usada por la ruta `/admin/drivers` (Task 14).

- [ ] **Paso 1: Crear el componente**

Crear `tukytuk-admin/src/admin/drivers/DriversListPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Stack, Chip, ToggleButton, ToggleButtonGroup,
  TextField, Table, TableHead, TableRow, TableCell, TableBody,
  TablePagination, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { listDrivers, setDriverStatus, type DriversListFilters, type DriverWithUser } from '../../api/drivers';

const STATUS_LABEL: Record<string, string> = { A: 'Aprobado', R: 'Rechazado', P: 'Pendiente' };
const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning'> = {
  A: 'success', R: 'error', P: 'warning'
};

export default function DriversListPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<DriversListFilters>({ status: 'A', search: '', page: 1, limit: 20 });
  const [rows, setRows] = useState<DriverWithUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DriverWithUser | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listDrivers(filters);
      setRows(r.drivers);
      setTotal(r.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el listado');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const onApprove = async (d: DriverWithUser) => {
    await setDriverStatus(d.driver.uid, 'A');
    await load();
  };

  const onConfirmReject = async () => {
    if (!rejectTarget) return;
    if (rejectComment.trim().length < 3) return;
    await setDriverStatus(rejectTarget.driver.uid, 'R', rejectComment.trim());
    setRejectTarget(null);
    setRejectComment('');
    await load();
  };

  const breadcrumbs = useMemo(() => [
    { label: 'Inicio', to: '/' },
    { label: 'Conductores' }
  ], []);

  return (
    <Box sx={{ p: 3 }}>
      <PageBreadcrumbs items={breadcrumbs} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4">Conductores</Typography>
        <Button variant="contained" onClick={() => navigate('/admin/drivers/new')}>
          + Nuevo conductor
        </Button>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filters.status ?? 'all'}
          onChange={(_e, v) => {
            if (v === null) return;
            setFilters((f) => ({ ...f, status: v === 'all' ? undefined : v, page: 1 }));
          }}
        >
          <ToggleButton value="all">Todos</ToggleButton>
          <ToggleButton value="A">Aprobados</ToggleButton>
          <ToggleButton value="P">Pendientes</ToggleButton>
          <ToggleButton value="R">Rechazados</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          label="Buscar"
          placeholder="nombre, email o placa"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          sx={{ minWidth: 280 }}
        />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Estado</TableCell>
                <TableCell>Nombre</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Placa</TableCell>
                <TableCell>Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.driver.uid}>
                  <TableCell>
                    <Chip
                      label={STATUS_LABEL[d.driver.status] ?? d.driver.status}
                      color={STATUS_COLOR[d.driver.status] ?? 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{d.usuario.nombre} {d.usuario.apellido ?? ''}</TableCell>
                  <TableCell>{d.usuario.email}</TableCell>
                  <TableCell>{d.driver.plate ?? '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => navigate('/admin/drivers/' + d.usuario.uid)}>
                        Editar
                      </Button>
                      <Button size="small" onClick={() => navigate('/admin/pagos?driverUid=' + d.usuario.uid)}>
                        Ir a pagos
                      </Button>
                      {d.driver.status === 'P' && (
                        <>
                          <Button size="small" color="success" variant="contained" onClick={() => onApprove(d)}>
                            Aprobar
                          </Button>
                          <Button size="small" color="error" variant="contained" onClick={() => setRejectTarget(d)}>
                            Rechazar
                          </Button>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography align="center" sx={{ py: 3 }}>Sin resultados</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={(filters.page ?? 1) - 1}
            onPageChange={(_e, newPage) => setFilters((f) => ({ ...f, page: newPage + 1 }))}
            rowsPerPage={filters.limit ?? 20}
            rowsPerPageOptions={[20]}
            labelRowsPerPage="Por página:"
          />
        </>
      )}

      <Dialog open={!!rejectTarget} onClose={() => setRejectTarget(null)}>
        <DialogTitle>Rechazar conductor</DialogTitle>
        <DialogContent>
          <TextField
            label="Motivo (mínimo 3 caracteres)" fullWidth multiline minRows={2}
            sx={{ mt: 1, minWidth: 360 }}
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
    </Box>
  );
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/admin/drivers/DriversListPage.tsx
git commit -m "feat(admin): DriversListPage con chips de status, busqueda, paginacion y aprobar/rechazar inline"
```

---

## Task 12: `DriverDetailPage`

**Files:**
- Create: `tukytuk-admin/src/admin/drivers/DriverDetailPage.tsx`

**Interfaces:**
- Consumes: `getDriver`, `updateDriver`, `uploadDriverImage`, `<PageBreadcrumbs>`, `<DriverImagePicker>`, `<SpecialPricingDialog>` (Spec 2).
- Produces: pantalla `/admin/drivers/:uid` con form de edición + dialog email + tres image pickers + sección de precio especial.

- [ ] **Paso 1: Crear el componente**

Crear `tukytuk-admin/src/admin/drivers/DriverDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Stack, TextField, MenuItem,
  CircularProgress, Card, CardContent, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { DriverImagePicker } from '../../components/DriverImagePicker';
import { SpecialPricingDialog } from '../payments/SpecialPricingDialog';
import {
  getDriver, updateDriver,
  type DriverWithUser, type UpdateDriverPayload
} from '../../api/drivers';
import axios from 'axios';

export default function DriverDetailPage() {
  const { uid = '' } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DriverWithUser | null>(null);
  const [form, setForm] = useState<UpdateDriverPayload>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [snack, setSnack] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getDriver(uid);
      setData(r);
      setForm({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el conductor');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const fullName = useMemo(() => {
    if (!data) return '';
    return `${data.usuario.nombre}${data.usuario.apellido ? ' ' + data.usuario.apellido : ''}`;
  }, [data]);

  const emailChanged = form.email !== undefined && form.email !== data?.usuario.email;

  const onSave = async () => {
    if (emailChanged) {
      setEmailDialogOpen(true);
      return;
    }
    await doSave();
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateDriver(uid, form);
      setData(updated);
      setForm({});
      setSnack({ kind: 'ok', text: 'Datos actualizados' });
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.data?.msg === 'email_duplicado') {
        setSnack({ kind: 'err', text: 'Ese email ya está en uso por otro usuario' });
      } else {
        setSnack({ kind: 'err', text: 'No se pudo guardar' });
      }
    } finally {
      setBusy(false);
      setEmailDialogOpen(false);
    }
  };

  const onImageUpdated = (field: 'imageProfile' | 'imageDPI1' | 'imageDPI2', url: string) => {
    if (!data) return;
    setData({ ...data, driver: { ...data.driver, [field]: url } });
  };

  if (loading) return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (error || !data) return <Box sx={{ p: 3 }}><Alert severity="error">{error ?? 'No encontrado'}</Alert></Box>;

  const u = { ...data.usuario, ...form };
  const d = { ...data.driver, ...form };

  const breadcrumbs = [
    { label: 'Inicio', to: '/' },
    { label: 'Conductores', to: '/admin/drivers' },
    { label: fullName }
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PageBreadcrumbs items={breadcrumbs} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4">{fullName}</Typography>
        <Button variant="outlined" onClick={() => navigate('/admin/pagos?driverUid=' + uid)}>
          Ir a pagos
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Datos</Typography>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField label="Nombre" required fullWidth value={u.nombre ?? ''} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
              <TextField label="Apellido" fullWidth value={u.apellido ?? ''} onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Email" required fullWidth value={u.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <TextField label="Teléfono" fullWidth value={u.telefono ?? ''} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Placa" required fullWidth value={d.plate ?? ''} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))} />
              <TextField label="Licencia local" required fullWidth value={d.locallicense ?? ''} onChange={(e) => setForm((f) => ({ ...f, locallicense: e.target.value }))} />
            </Stack>
            <TextField label="Dirección" required fullWidth value={d.address ?? ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            <TextField select label="Estado" value={d.status ?? 'P'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'A'|'R'|'P' }))}>
              <MenuItem value="A">Aprobado</MenuItem>
              <MenuItem value="R">Rechazado</MenuItem>
              <MenuItem value="P">Pendiente</MenuItem>
            </TextField>
            <TextField label="Comentarios del admin" fullWidth multiline minRows={2} value={d.commentsAdmin ?? ''} onChange={(e) => setForm((f) => ({ ...f, commentsAdmin: e.target.value }))} />
            <Stack direction="row" justifyContent="flex-end" spacing={2}>
              <Button onClick={() => setForm({})} disabled={busy || Object.keys(form).length === 0}>Cancelar</Button>
              <Button variant="contained" onClick={onSave} disabled={busy || Object.keys(form).length === 0}>
                {busy ? 'Guardando…' : 'Guardar'}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Precio especial</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {data.driver.specialPrice != null
              ? `Actual: ${data.driver.specialPrice} / ${data.driver.specialDurationDays ?? '—'} días`
              : 'Usa el precio base configurado.'}
          </Typography>
          <Button variant="outlined" onClick={() => setPricingOpen(true)}>Editar precio especial</Button>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Imágenes</Typography>
          <Stack direction="row" spacing={3} flexWrap="wrap">
            <DriverImagePicker
              driverUid={uid} tipo="perfil" label="Foto de perfil"
              currentUrl={data.driver.imageProfile || undefined}
              onUploaded={(u) => onImageUpdated('imageProfile', u)}
            />
            <DriverImagePicker
              driverUid={uid} tipo="dpi1" label="DPI frontal"
              currentUrl={data.driver.imageDPI1 || undefined}
              onUploaded={(u) => onImageUpdated('imageDPI1', u)}
            />
            <DriverImagePicker
              driverUid={uid} tipo="dpi2" label="DPI posterior"
              currentUrl={data.driver.imageDPI2 || undefined}
              onUploaded={(u) => onImageUpdated('imageDPI2', u)}
            />
          </Stack>
        </CardContent>
      </Card>

      <Dialog
        open={emailDialogOpen}
        onClose={(_e, reason) => { if (reason !== 'backdropClick') setEmailDialogOpen(false); }}
        disableEscapeKeyDown
      >
        <DialogTitle>Cambiar email de login</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Cambiar el email a <strong>{form.email}</strong>? El conductor deberá usar el nuevo email para iniciar sesión.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailDialogOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="contained" onClick={doSave} disabled={busy}>
            {busy ? 'Guardando…' : 'Confirmar y guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      <SpecialPricingDialog
        open={pricingOpen}
        driverUid={uid}
        initialPrice={data.driver.specialPrice}
        initialDurationDays={data.driver.specialDurationDays}
        onClose={() => setPricingOpen(false)}
        onSaved={() => { setPricingOpen(false); load(); }}
      />

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)}>
        {snack ? <Alert severity={snack.kind === 'ok' ? 'success' : 'error'}>{snack.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
```

- [ ] **Paso 2: Lint**

```bash
cd tukytuk-admin
npm run lint
```

Si `SpecialPricingDialog` no expone exactamente esa firma (revisar `src/admin/payments/SpecialPricingDialog.tsx`), ajustar al firma actual.

- [ ] **Paso 3: Commit**

```bash
cd tukytuk-admin
git add src/admin/drivers/DriverDetailPage.tsx
git commit -m "feat(admin): DriverDetailPage con edicion completa, dialog email, imagenes y precio especial"
```

---

## Task 13: Aplicar Autocomplete y Breadcrumb a pantallas existentes

**Files:**
- Modify: `tukytuk-admin/src/admin/payments/PaymentsListPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/CreateManualPaymentPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/PaymentSettingsPage.tsx`
- Modify: `tukytuk-admin/src/admin/payments/SpecialPricingPage.tsx`
- Modify: `tukytuk-admin/src/admin/drivers/CreateDriverPage.tsx`

**Interfaces:**
- Consumes: `<DriverAutocomplete>` (T9), `<PageBreadcrumbs>` (T8).

- [ ] **Paso 1: PaymentsListPage — autocomplete + breadcrumb + query param**

Editar `src/admin/payments/PaymentsListPage.tsx`:

1. Imports nuevos al inicio:

```tsx
import { useSearchParams } from 'react-router-dom';
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { DriverAutocomplete } from '../../components/DriverAutocomplete';
```

2. Dentro del componente, antes del `return`, leer el query param:

```tsx
const [searchParams] = useSearchParams();
useEffect(() => {
  const qpDriver = searchParams.get('driverUid');
  if (qpDriver) setFilters((f) => ({ ...f, driverUid: qpDriver, page: 1 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

3. Reemplazar el TextField de "Conductor (uid)" por:

```tsx
<Box sx={{ minWidth: 320 }}>
  <DriverAutocomplete
    value={filters.driverUid ?? null}
    onChange={(uid) => setFilters({ ...filters, driverUid: uid ?? undefined, page: 1 })}
    label="Conductor"
  />
</Box>
```

4. Arriba del título de la página agregar:

```tsx
<PageBreadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Pagos' }]} />
```

- [ ] **Paso 2: CreateManualPaymentPage — autocomplete + breadcrumb**

Editar `src/admin/payments/CreateManualPaymentPage.tsx`:

1. Imports:

```tsx
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { DriverAutocomplete } from '../../components/DriverAutocomplete';
```

2. Reemplazar TextField de driverUid por:

```tsx
<DriverAutocomplete
  value={driverUid || null}
  onChange={(uid) => setDriverUid(uid ?? '')}
  label="Conductor"
  required
/>
```

3. Antes del título:

```tsx
<PageBreadcrumbs items={[
  { label: 'Inicio', to: '/' },
  { label: 'Pagos', to: '/admin/pagos' },
  { label: 'Nuevo pago' }
]} />
```

- [ ] **Paso 3: PaymentSettingsPage — breadcrumb**

Editar `src/admin/payments/PaymentSettingsPage.tsx`. Antes del título:

```tsx
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
// ...
<PageBreadcrumbs items={[
  { label: 'Inicio', to: '/' },
  { label: 'Pagos', to: '/admin/pagos' },
  { label: 'Configuración' }
]} />
```

- [ ] **Paso 4: SpecialPricingPage — autocomplete + breadcrumb**

Editar `src/admin/payments/SpecialPricingPage.tsx`:

1. Imports:

```tsx
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
import { DriverAutocomplete } from '../../components/DriverAutocomplete';
```

2. Reemplazar TextField de driverUid por:

```tsx
<DriverAutocomplete
  value={driverUid || null}
  onChange={(uid) => setDriverUid(uid ?? '')}
  label="Conductor"
  required
/>
```

3. Antes del título:

```tsx
<PageBreadcrumbs items={[
  { label: 'Inicio', to: '/' },
  { label: 'Pagos', to: '/admin/pagos' },
  { label: 'Precio especial' }
]} />
```

- [ ] **Paso 5: CreateDriverPage — breadcrumb**

Editar `src/admin/drivers/CreateDriverPage.tsx`. Antes del título de la página:

```tsx
import { PageBreadcrumbs } from '../../components/PageBreadcrumbs';
// ...
<PageBreadcrumbs items={[
  { label: 'Inicio', to: '/' },
  { label: 'Conductores', to: '/admin/drivers' },
  { label: 'Nuevo' }
]} />
```

- [ ] **Paso 6: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: cero warnings, build exitoso.

- [ ] **Paso 7: Commit**

```bash
cd tukytuk-admin
git add src/admin/payments/PaymentsListPage.tsx src/admin/payments/CreateManualPaymentPage.tsx src/admin/payments/PaymentSettingsPage.tsx src/admin/payments/SpecialPricingPage.tsx src/admin/drivers/CreateDriverPage.tsx
git commit -m "feat(admin): autocomplete y breadcrumbs en pantallas de pagos y crear conductor"
```

---

## Task 14: Routing + sidebar + eliminar PendingDriversPage

**Files:**
- Modify: `tukytuk-admin/src/journal/routes/JournalRoutes.jsx`
- Modify: `tukytuk-admin/src/admin/layout/AdminSidebar.tsx`
- Delete: `tukytuk-admin/src/admin/drivers/PendingDriversPage.tsx`

**Interfaces:**
- Consumes: `DriversListPage` (T11), `DriverDetailPage` (T12).

- [ ] **Paso 1: Editar `JournalRoutes.jsx`**

Editar `src/journal/routes/JournalRoutes.jsx`:

1. Cambiar imports:
   - Quitar: `import PendingDriversPage from "../../admin/drivers/PendingDriversPage"`.
   - Agregar:
     ```jsx
     import DriversListPage from "../../admin/drivers/DriversListPage"
     import DriverDetailPage from "../../admin/drivers/DriverDetailPage"
     import { Navigate } from "react-router-dom"  // si no estaba ya
     ```

2. Reemplazar las rutas de conductores. La sección queda:

```jsx
<Route path="/" element={<Navigate to="/admin/drivers" replace />} />
<Route path="/admin/drivers" element={<DriversListPage />} />
<Route path="/admin/drivers/new" element={<CreateDriverPage />} />
<Route path="/admin/drivers/:uid" element={<DriverDetailPage />} />
<Route path="/admin/drivers/pending" element={<Navigate to="/admin/drivers?status=P" replace />} />
<Route path="/admin/otps/pending" element={<PendingOtpsPage />} />
```

(Nota: el redirect inicial cambia de `/admin/drivers/pending` a `/admin/drivers`. Si tu admin tenía ese redirect en otra parte, ajustar para coincidir.)

- [ ] **Paso 2: Editar `AdminSidebar.tsx`**

Editar `src/admin/layout/AdminSidebar.tsx`. Cambiar `NAV_ITEMS`:

```tsx
import GroupsIcon from '@mui/icons-material/Groups';
// ...
const NAV_ITEMS = [
  { label: 'Inicio', path: '/', icon: <DashboardOutlinedIcon /> },
  { label: 'Conductores', path: '/admin/drivers', icon: <GroupsIcon /> },
  { label: 'OTPs pendientes', path: '/admin/otps/pending', icon: <MailLockIcon /> },
  { label: 'Pagos', path: '/admin/pagos', icon: <PaymentsIcon /> },
];
```

(Quitar imports no usados como `PendingActionsIcon` y `PersonAddIcon` si quedan huérfanos.)

- [ ] **Paso 3: Eliminar `PendingDriversPage.tsx`**

```bash
cd tukytuk-admin
git rm src/admin/drivers/PendingDriversPage.tsx
```

- [ ] **Paso 4: Lint + build**

```bash
cd tukytuk-admin
npm run lint
npm run build
```

Esperado: lint sin warnings (ningún import huérfano), build exitoso.

- [ ] **Paso 5: Verificación manual**

Si tienes el dev server corriendo: navegar a `/admin/drivers/pending` → debe redirigir a `/admin/drivers?status=P`. El sidebar debe mostrar solo "Conductores" entre los items de drivers.

- [ ] **Paso 6: Commit**

```bash
cd tukytuk-admin
git add src/journal/routes/JournalRoutes.jsx src/admin/layout/AdminSidebar.tsx
git commit -m "feat(admin): rutas del directorio de conductores, sidebar actualizado y redirect de pending"
```

---

## Notas finales

- **`getListDriver` y `/usuarios/driver/adminListDriverPending`** del backend quedan vivos por compatibilidad (admin viejo en caché del cliente, scripts), pero el admin nuevo ya no los llama. Marcar como `// @deprecated` en un comentario inline al cerrar este plan, para limpieza futura.
- **Verificación manual del golden path** (post-implementación) en sección 8.3 del spec: directorio → búsqueda → editar → cambiar email → email duplicado → subir imagen → ir a pagos → autocomplete en pagos → breadcrumb → redirect de pending.
- **Despliegue:** crear `uploads/drivers/` con permisos del proceso Node antes del primer upload. Sin migración de datos. Sin variables nuevas. Orden: backend → admin.
- **Bugs preexistentes NO tocados:** se respeta el constraint global. Si algún test del Spec 1/2 falla por motivos no relacionados, se anota como follow-up.
