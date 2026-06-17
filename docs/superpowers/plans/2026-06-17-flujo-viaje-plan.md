# Flujo de viaje — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** Arreglar el loop completo de viaje en TukyTuk — autocomplete robusto, botón cancelar, vista real del conductor con ruta/tiempo/distancia, aceptar/rechazar, y ubicación en vivo entre ambos durante el viaje vía sockets.

**Architecture:** Modelo `Trip` se extiende con estado `C` (cancelado) y `rejectedBy`. Endpoints nuevos: `cancelTrip` y `rejectTrip`. Sockets emiten `trip-accepted`, `trip-status-changed`, `location-update` para baja latencia; el polling se baja de 2s a 5s y queda como fallback. En Flutter, el `SearchBloc` gana estados explícitos `loading/ok/failed`, la pantalla del conductor abandona el mock y muestra viajes reales con preview de ruta, y un nuevo `TripPreviewSheet` agrupa el ver/aceptar/rechazar.

**Tech Stack:**
- Backend: Node.js + Express + Mongoose + Socket.IO. Tests con `node:test` (`node --test tests/*.test.js`).
- Flutter: `flutter_bloc`, `provider`, `socket_io_client`, `flutter_map` + `google_maps_flutter`, `dio` (autocomplete), `http` (TripService), `flutter_dotenv`.

## Global Constraints

- Idioma: todos los strings de UI, mensajes de error visibles, comentarios nuevos y mensajes de commit van en español. Los identificadores de código siguen el estilo del archivo existente (mezcla español/inglés, no normalizar).
- Convención del modelo `Trip`: el campo del pasajero se llama `usuario` (no `user`). Los endpoints reciben `uid_trip` en el body (no `tripId`). Las respuestas usan el shape `{ ok: boolean, msg: string, ... }`.
- Convención de IDs: `usuario`, `driver`, y elementos de `rejectedBy` son `ObjectId` con `ref: 'Usuario'`. En queries comparar como `ObjectId` (Mongoose convierte strings automáticamente; no comparar con `===` strings).
- Convención de tests backend: `node:test` + `node:assert/strict`. Tests unitarios mockean las dependencias (no levantan MongoDB ni Express). Patrón ya establecido en `tests/validar-admin.test.js`.
- No tocar bugs preexistentes fuera del alcance del plan (ej. `controllers/trip.js:44` tiene `req.params.uid .uid`, `controllers/trip.js:159` tiene `usuario.findOne` con `usuario` minúsculas). Si una tarea los expone, anotar pero no corregir.
- Commits: estilo conventional commits en español (`feat(backend):`, `fix(flutter):`, `test(backend):`, `docs(backend):`). Co-author de Claude solo si el usuario lo pide explícitamente — por defecto no incluirlo en commits de este plan.
- Cada tarea termina con `git add` de archivos específicos por nombre (nunca `git add -A` ni `git add .`) y `git commit` con mensaje conventional.

---

## Estructura de archivos a tocar

**Backend (`tukytukapi/`):**
- Modificar: `models/trip.js` (estado `C`, `rejectedBy`, `cancelledAt`, índice).
- Modificar: `controllers/trip.js` (cancelTrip, rejectTrip nuevos; acceptTrip/statusTrip emiten sockets; getDriverListTrip filtra rejectedBy).
- Modificar: `routes/trip.js` (nuevas rutas con express-validator).
- Modificar: `sockets/socket.js` (handler `location-update`).
- Crear: `tests/trip-cancel.test.js`.
- Crear: `tests/trip-reject.test.js`.
- Crear: `tests/trip-accept-status.test.js`.
- Crear: `tests/trip-list.test.js`.

**Flutter (`tukytuk/`):**
- Modificar: `tukytuk/.env` y `.env.example` (agregar `MAPBOX_TOKEN`).
- Modificar: `tukytuk/lib/const/general.dart` (exponer `Constants.mapboxToken`).
- Modificar: `tukytuk/lib/services/places_intercerptor.dart` (leer token de `.env`).
- Modificar: `tukytuk/lib/blocs/search/search_state.dart` y `search_bloc.dart` (estados `loading`/`ok`/`failed`).
- Modificar: `tukytuk/lib/delegates/search_destination_delegate.dart` (banner de error, opción manual destacada).
- Modificar: `tukytuk/lib/services/trip_service.dart` (agregar `cancelTrip`, `rejectTrip`).
- Modificar: `tukytuk/lib/screens/map_screen.dart` (botón cancelar, listener `trip-accepted`, emisión ubicación, marcador conductor, polling 5s).
- Modificar: `tukytuk/lib/screens/map_driver_screen.dart` (emisión ubicación, marcador pasajero, polling 5s).
- Modificar: `tukytuk/lib/pages/trip_driver_page.dart` (eliminar mock, listado real).
- Crear: `tukytuk/lib/widgets/trip_preview_sheet.dart` (BottomSheet con polyline, tiempo, distancia, aceptar/rechazar).
- Modificar: `tukytuk/lib/services/socket_service.dart` (listeners + helpers de emisión).
- Crear: `tukytuk/test/search_bloc_test.dart`.
- Crear: `tukytuk/test/btn_cancel_widget_test.dart`.

---

## Tarea 1: Modelo Trip — estado C, rejectedBy, cancelledAt e índice

**Files:**
- Modify: `tukytukapi/models/trip.js`
- Test: `tukytukapi/tests/trip-model.test.js` (crear)

**Interfaces:**
- Produces: el esquema `Trip` con `user_status` ahora ∈ `['S','A','P','F','C']`, campo nuevo `rejectedBy: [ObjectId(Usuario)]`, campo nuevo `cancelledAt: Date`, índice compuesto `{ user_status: 1, usuario: 1, rejectedBy: 1 }`. El controller `getDriverListTrip` lo consumirá en la Tarea 3, y `cancelTrip` en la Tarea 2.

- [ ] **Paso 1: Crear el test del modelo (failing)**

Crear `tukytukapi/tests/trip-model.test.js` con:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const Trip = require('../models/trip');

test('Trip schema acepta user_status C', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        user_status: 'C'
    });
    const err = trip.validateSync();
    assert.equal(err, undefined, 'no debería haber error de validación');
    assert.equal(trip.user_status, 'C');
});

test('Trip schema tiene rejectedBy vacío por defecto', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4'
    });
    assert.deepEqual(trip.rejectedBy.toObject(), []);
});

test('Trip schema acepta cancelledAt', () => {
    const now = new Date();
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        cancelledAt: now
    });
    assert.equal(trip.cancelledAt.getTime(), now.getTime());
});

test('Trip schema rechaza user_status fuera del enum', () => {
    const trip = new Trip({
        usuario: '507f1f77bcf86cd799439011',
        start_lat: '14.6', start_lng: '-90.5',
        end_lat: '14.7', end_lng: '-90.4',
        user_status: 'X'
    });
    const err = trip.validateSync();
    assert.ok(err, 'debería haber error de validación');
    assert.match(err.errors.user_status.message, /X/);
});
```

- [ ] **Paso 2: Correr el test para confirmar que falla**

```bash
cd tukytukapi
node --test tests/trip-model.test.js
```

Esperado: 2 tests fallan (`user_status C` y `rechaza X` fallan porque hoy no hay enum; `rejectedBy` falla porque el campo no existe).

- [ ] **Paso 3: Modificar el modelo Trip**

Editar `tukytukapi/models/trip.js`:

```js
const { Schema, model } = require('mongoose');

const TripSchema = Schema({
    usuario: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    user_status: {
        type: String,
        enum: ['S', 'A', 'P', 'F', 'C'],
        default: 'S'
    },
    start_lat: { type: String, required: true },
    start_lng: { type: String, required: true },
    end_lat: { type: String, required: true },
    end_lng: { type: String, required: true },
    driver: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: false
    },
    driver_status: {
        type: String,
        default: 'P'
    },
    driver_start_lat: { type: String, default: '' },
    driver_start_lng: { type: String, default: '' },
    rejectedBy: {
        type: [{ type: Schema.Types.ObjectId, ref: 'Usuario' }],
        default: []
    },
    cancelledAt: { type: Date }
}, {
    timestamps: true
});

TripSchema.index({ user_status: 1, usuario: 1, rejectedBy: 1 });

TripSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
});

module.exports = model('Trip', TripSchema);
```

- [ ] **Paso 4: Correr el test para confirmar que pasa**

```bash
cd tukytukapi
node --test tests/trip-model.test.js
```

Esperado: los 4 tests pasan.

- [ ] **Paso 5: Correr toda la suite para verificar que nada se rompió**

```bash
cd tukytukapi
npm test
```

Esperado: todos los tests existentes siguen pasando.

- [ ] **Paso 6: Commit**

```bash
cd tukytukapi
git add models/trip.js tests/trip-model.test.js
git commit -m "feat(backend): trip soporta estado C cancelado, rejectedBy y cancelledAt"
```

---

## Tarea 2: Endpoint cancelTrip

**Files:**
- Modify: `tukytukapi/controllers/trip.js` (agregar `cancelUserTrip`)
- Modify: `tukytukapi/routes/trip.js` (agregar `PUT /user/cancelTrip`)
- Test: `tukytukapi/tests/trip-cancel.test.js` (crear)

**Interfaces:**
- Consumes: `Trip` con estado `C` y `cancelledAt` (Tarea 1).
- Produces: handler `cancelUserTrip(req, res)` exportado por `controllers/trip.js`; ruta `PUT /api/trip/user/cancelTrip` que recibe `{ uid_trip }` en el body y requiere JWT. Devuelve `{ ok: true, trip }` o `{ ok: false, msg, status }`.

- [ ] **Paso 1: Crear el test del controller (failing)**

Crear `tukytukapi/tests/trip-cancel.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { cancelUserTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

const stubMongo = (t) => {
    const originalFindOne = Trip.findOne;
    const originalSave = Trip.prototype.save;
    t.after(() => {
        Trip.findOne = originalFindOne;
        Trip.prototype.save = originalSave;
    });
};

test('cancelUserTrip 404 si el viaje no existe', async (t) => {
    stubMongo(t);
    Trip.findOne = async () => null;

    const req = { uid: 'uA', body: { uid_trip: 'tX' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
});

test('cancelUserTrip 403 si el viaje no pertenece al usuario', async (t) => {
    stubMongo(t);
    Trip.findOne = async () => ({
        usuario: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        user_status: 'S',
        save: async function() { return this; }
    });

    const req = { uid: '507f1f77bcf86cd799439099', body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
});

test('cancelUserTrip 409 si user_status no es S', async (t) => {
    stubMongo(t);
    const ownerId = new mongoose.Types.ObjectId();
    Trip.findOne = async () => ({
        usuario: ownerId,
        user_status: 'A',
        save: async function() { return this; }
    });

    const req = { uid: ownerId.toString(), body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.match(res.body.msg, /solo se puede cancelar/i);
});

test('cancelUserTrip 200 setea user_status=C y cancelledAt', async (t) => {
    stubMongo(t);
    const ownerId = new mongoose.Types.ObjectId();
    const saved = {
        usuario: ownerId,
        user_status: 'S',
        save: async function() { return this; }
    };
    Trip.findOne = async () => saved;

    const req = { uid: ownerId.toString(), body: { uid_trip: 't1' } };
    const res = makeRes();
    await cancelUserTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.trip.user_status, 'C');
    assert.ok(res.body.trip.cancelledAt instanceof Date);
});
```

- [ ] **Paso 2: Correr el test para confirmar que falla**

```bash
cd tukytukapi
node --test tests/trip-cancel.test.js
```

Esperado: falla con `cancelUserTrip is not a function` (aún no se exporta).

- [ ] **Paso 3: Implementar el controller**

Editar `tukytukapi/controllers/trip.js`. Agregar al inicio del archivo, antes de `module.exports`:

```js
const cancelUserTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        if (String(trip.usuario) !== String(req.uid)) {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }
        if (trip.user_status !== 'S') {
            return res.status(409).json({
                ok: false,
                msg: 'Solo se puede cancelar mientras está solicitado'
            });
        }
        trip.user_status = 'C';
        trip.cancelledAt = new Date();
        await trip.save();
        return res.status(200).json({ ok: true, msg: 'Trip cancelado', trip });
    } catch (err) {
        console.error('cancelUserTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Y agregar `cancelUserTrip` al `module.exports`:

```js
module.exports = {
    setUserTrip,
    getUserActiveTrip,
    getUserListTripCompleted,
    getDriverListTrip,
    setDriverAcceptTrip,
    setDriverStatusTrip,
    getDriverActiveTrip,
    getUserTrip,
    cancelUserTrip
};
```

- [ ] **Paso 4: Correr el test para confirmar que pasa**

```bash
cd tukytukapi
node --test tests/trip-cancel.test.js
```

Esperado: los 4 tests pasan.

- [ ] **Paso 5: Agregar la ruta**

Editar `tukytukapi/routes/trip.js`. Agregar antes del `module.exports`:

```js
router.put('/user/cancelTrip', [
    check('uid_trip', 'uid_trip es obligatorio').not().isEmpty(),
    validarCampos,
    validarJWT
], tripController.cancelUserTrip);
```

- [ ] **Paso 6: Smoke manual de la ruta (opcional pero recomendado)**

Con el backend corriendo (`npm run start:dev`), un viaje en `S` y un token válido:

```bash
curl -X PUT http://localhost:8000/api/trip/user/cancelTrip \
  -H "Content-Type: application/json" \
  -H "x-token: <token>" \
  -d '{"uid_trip":"<id>"}'
```

Esperado: `{ "ok": true, "msg": "Trip cancelado", "trip": { ..., "user_status": "C", "cancelledAt": "..." } }`.

- [ ] **Paso 7: Commit**

```bash
cd tukytukapi
git add controllers/trip.js routes/trip.js tests/trip-cancel.test.js
git commit -m "feat(backend): endpoint PUT /trip/user/cancelTrip"
```

---

## Tarea 3: Endpoint rejectTrip y filtro en getDriverListTrip

**Files:**
- Modify: `tukytukapi/controllers/trip.js` (agregar `setDriverRejectTrip`, modificar `getDriverListTrip`)
- Modify: `tukytukapi/routes/trip.js` (agregar `PUT /driver/rejectTrip`)
- Test: `tukytukapi/tests/trip-reject.test.js` (crear)
- Test: `tukytukapi/tests/trip-list.test.js` (crear)

**Interfaces:**
- Consumes: `Trip.rejectedBy` (Tarea 1).
- Produces: handler `setDriverRejectTrip(req, res)`; ruta `PUT /api/trip/driver/rejectTrip` con body `{ uid_trip }`. `getDriverListTrip` ahora excluye viajes con el `driver` actual en `rejectedBy`. Usado por la Tarea 4 (accept rechazará si `rejectedBy` lo contiene) y por la Tarea 10 en Flutter.

- [ ] **Paso 1: Crear el test de rejectTrip (failing)**

Crear `tukytukapi/tests/trip-reject.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { setDriverRejectTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('setDriverRejectTrip 409 si el viaje ya no está en S', async (t) => {
    const original = Trip.updateOne;
    t.after(() => { Trip.updateOne = original; });
    Trip.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

    const req = { uid: 'd1', body: { uid_trip: 't1' } };
    const res = makeRes();
    await setDriverRejectTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
});

test('setDriverRejectTrip 200 agrega el driver a rejectedBy con $addToSet', async (t) => {
    const original = Trip.updateOne;
    t.after(() => { Trip.updateOne = original; });

    let calledWithFilter;
    let calledWithUpdate;
    Trip.updateOne = async (filter, update) => {
        calledWithFilter = filter;
        calledWithUpdate = update;
        return { matchedCount: 1, modifiedCount: 1 };
    };

    const req = { uid: 'driver-uid-1', body: { uid_trip: 'trip-id-1' } };
    const res = makeRes();
    await setDriverRejectTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(calledWithFilter._id, 'trip-id-1');
    assert.equal(calledWithFilter.user_status, 'S');
    assert.deepEqual(calledWithUpdate, { $addToSet: { rejectedBy: 'driver-uid-1' } });
});
```

- [ ] **Paso 2: Crear el test de getDriverListTrip (failing)**

Crear `tukytukapi/tests/trip-list.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { getDriverListTrip } = require('../controllers/trip');
const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

test('getDriverListTrip excluye viajes con el driver en rejectedBy', async (t) => {
    const originalFind = Trip.find;
    t.after(() => { Trip.find = originalFind; });

    let capturedQuery;
    Trip.find = (q) => {
        capturedQuery = q;
        return {
            sort() { return this; },
            limit() { return Promise.resolve([]); }
        };
    };

    const req = { uid: 'driver-1' };
    const res = makeRes();
    await getDriverListTrip(req, res);

    assert.equal(capturedQuery.user_status, 'S');
    assert.deepEqual(capturedQuery.usuario, { $ne: 'driver-1' });
    assert.deepEqual(capturedQuery.rejectedBy, { $ne: 'driver-1' });
});
```

- [ ] **Paso 3: Correr los tests para confirmar que fallan**

```bash
cd tukytukapi
node --test tests/trip-reject.test.js tests/trip-list.test.js
```

Esperado: `trip-reject` falla porque `setDriverRejectTrip` no existe; `trip-list` falla porque el query actual no incluye `rejectedBy`.

- [ ] **Paso 4: Implementar setDriverRejectTrip**

En `tukytukapi/controllers/trip.js`, agregar antes del `module.exports`:

```js
const setDriverRejectTrip = async (req, res = response) => {
    try {
        const result = await Trip.updateOne(
            { _id: req.body.uid_trip, user_status: 'S' },
            { $addToSet: { rejectedBy: req.uid } }
        );
        if (result.matchedCount === 0) {
            return res.status(409).json({ ok: false, msg: 'Viaje no disponible' });
        }
        return res.status(200).json({ ok: true, msg: 'Viaje rechazado' });
    } catch (err) {
        console.error('setDriverRejectTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Y agregarlo al `module.exports` junto con `cancelUserTrip` de la Tarea 2.

- [ ] **Paso 5: Modificar getDriverListTrip**

Reemplazar la query existente en `controllers/trip.js`:

```js
const getDriverListTrip = async (req, res = response) => {
    try {
        const trips = await Trip.find({
            user_status: 'S',
            usuario: { $ne: req.uid },
            rejectedBy: { $ne: req.uid }
        })
        .sort({ createdAt: 'desc' })
        .limit(10);

        return res.json({
            ok: true,
            msg: 'Viajes disponibles',
            trips,
        });
    } catch (err) {
        console.error('getDriverListTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

- [ ] **Paso 6: Correr los tests para confirmar que pasan**

```bash
cd tukytukapi
node --test tests/trip-reject.test.js tests/trip-list.test.js
```

Esperado: ambos archivos pasan.

- [ ] **Paso 7: Agregar la ruta de reject**

En `tukytukapi/routes/trip.js`, antes del `module.exports`:

```js
router.put('/driver/rejectTrip', [
    check('uid_trip', 'uid_trip es obligatorio').not().isEmpty(),
    validarCampos,
    validarJWT
], tripController.setDriverRejectTrip);
```

- [ ] **Paso 8: Correr toda la suite**

```bash
cd tukytukapi
npm test
```

Esperado: todos pasan.

- [ ] **Paso 9: Commit**

```bash
cd tukytukapi
git add controllers/trip.js routes/trip.js tests/trip-reject.test.js tests/trip-list.test.js
git commit -m "feat(backend): rechazar viaje (driver) y filtrar rejectedBy en listado"
```

---

## Tarea 4: acceptTrip y statusTrip — validación rejectedBy y emisión de sockets

**Files:**
- Modify: `tukytukapi/controllers/trip.js` (`setDriverAcceptTrip`, `setDriverStatusTrip`)
- Test: `tukytukapi/tests/trip-accept-status.test.js` (crear)

**Interfaces:**
- Consumes: `Trip.rejectedBy` (Tarea 1), `io` (instancia exportada por `index.js`).
- Produces: tras aceptar, emite `trip-accepted` a la sala del pasajero (`String(trip.usuario)`). Tras `statusTrip` con `P` o `F`, emite `trip-status-changed` con `{ uid_trip, user_status, driver_status }` a la sala del pasajero. Tarea 11 (Flutter) lo consume.

- [ ] **Paso 1: Crear el test (failing)**

Crear `tukytukapi/tests/trip-accept-status.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Trip = require('../models/trip');

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
});

// Spy mínimo del módulo index (donde vive io)
const ioCalls = [];
const fakeIo = {
    to(room) {
        return {
            emit(event, payload) {
                ioCalls.push({ room, event, payload });
            }
        };
    }
};

// Mockear el require de '../index' antes de cargar el controller
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '../index' || request.endsWith('/index')) {
        return { io: fakeIo };
    }
    return originalLoad(request, parent, isMain);
};

const { setDriverAcceptTrip, setDriverStatusTrip } = require('../controllers/trip');

test.after(() => {
    Module._load = originalLoad;
});

test('setDriverAcceptTrip 409 si el driver está en rejectedBy', async (t) => {
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });
    Trip.findOne = async () => ({
        rejectedBy: [{ toString: () => 'driver-1' }],
        user_status: 'S',
        save: async function() { return this; }
    });

    const req = {
        uid: 'driver-1',
        body: { uid_trip: 't1', driver_start_lat: '14.6', driver_start_lng: '-90.5' }
    };
    const res = makeRes();
    await setDriverAcceptTrip(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
});

test('setDriverAcceptTrip 200 emite trip-accepted al pasajero', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        usuario: passengerId,
        rejectedBy: [],
        user_status: 'S',
        driver_status: 'P',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = {
        uid: 'driver-1',
        body: { uid_trip: 't1', driver_start_lat: '14.6', driver_start_lng: '-90.5' }
    };
    const res = makeRes();
    await setDriverAcceptTrip(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(tripDoc.user_status, 'A');
    assert.equal(tripDoc.driver_status, 'R');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(passengerId));
    assert.equal(ioCalls[0].event, 'trip-accepted');
    assert.ok(ioCalls[0].payload.trip);
});

test('setDriverStatusTrip emite trip-status-changed cuando driver_status es P', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        _id: 'trip-id-1',
        usuario: passengerId,
        user_status: 'A',
        driver_status: 'R',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = { uid: 'driver-1', body: { uid_trip: 'trip-id-1', driver_status: 'P' } };
    const res = makeRes();
    await setDriverStatusTrip(req, res);

    assert.equal(tripDoc.user_status, 'P');
    assert.equal(tripDoc.driver_status, 'P');
    assert.equal(ioCalls.length, 1);
    assert.equal(ioCalls[0].room, String(passengerId));
    assert.equal(ioCalls[0].event, 'trip-status-changed');
    assert.equal(ioCalls[0].payload.driver_status, 'P');
});

test('setDriverStatusTrip emite trip-status-changed cuando driver_status es F', async (t) => {
    ioCalls.length = 0;
    const original = Trip.findOne;
    t.after(() => { Trip.findOne = original; });

    const passengerId = new mongoose.Types.ObjectId();
    const tripDoc = {
        _id: 'trip-id-1',
        usuario: passengerId,
        user_status: 'P',
        driver_status: 'P',
        save: async function() { return this; }
    };
    Trip.findOne = async () => tripDoc;

    const req = { uid: 'driver-1', body: { uid_trip: 'trip-id-1', driver_status: 'F' } };
    const res = makeRes();
    await setDriverStatusTrip(req, res);

    assert.equal(tripDoc.user_status, 'F');
    assert.equal(ioCalls[0].event, 'trip-status-changed');
    assert.equal(ioCalls[0].payload.driver_status, 'F');
});
```

- [ ] **Paso 2: Correr el test para confirmar que falla**

```bash
cd tukytukapi
node --test tests/trip-accept-status.test.js
```

Esperado: los 4 tests fallan (validación de `rejectedBy` no existe, emit de sockets no existe).

- [ ] **Paso 3: Modificar setDriverAcceptTrip**

Reemplazar el handler completo en `controllers/trip.js`. Importa `io` al inicio del archivo (cerca de los requires):

```js
const { io } = require('../index');
```

Implementación nueva:

```js
const setDriverAcceptTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        const rejected = (trip.rejectedBy || []).some(id => String(id) === String(req.uid));
        if (rejected) {
            return res.status(409).json({ ok: false, msg: 'Ya rechazaste este viaje' });
        }
        if (trip.user_status !== 'S') {
            return res.status(409).json({ ok: false, msg: 'Viaje no disponible' });
        }

        trip.user_status = 'A';
        trip.driver_status = 'R';
        trip.driver = req.uid;
        trip.driver_start_lat = req.body.driver_start_lat;
        trip.driver_start_lng = req.body.driver_start_lng;
        await trip.save();

        io.to(String(trip.usuario)).emit('trip-accepted', { trip });

        return res.status(200).json({ ok: true, msg: 'Trip aceptado', trip });
    } catch (err) {
        console.error('setDriverAcceptTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

- [ ] **Paso 4: Modificar setDriverStatusTrip**

Reemplazar:

```js
const setDriverStatusTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        trip.driver_status = req.body.driver_status;
        if (req.body.driver_status === 'F') trip.user_status = 'F';
        if (req.body.driver_status === 'P') trip.user_status = 'P';
        await trip.save();

        if (req.body.driver_status === 'P' || req.body.driver_status === 'F') {
            io.to(String(trip.usuario)).emit('trip-status-changed', {
                uid_trip: String(trip._id),
                user_status: trip.user_status,
                driver_status: trip.driver_status
            });
        }

        return res.status(200).json({ ok: true, msg: 'Trip actualizado', trip });
    } catch (err) {
        console.error('setDriverStatusTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

- [ ] **Paso 5: Correr el test para confirmar que pasa**

```bash
cd tukytukapi
node --test tests/trip-accept-status.test.js
```

Esperado: 4 tests pasan.

- [ ] **Paso 6: Correr toda la suite**

```bash
cd tukytukapi
npm test
```

Esperado: todos pasan.

- [ ] **Paso 7: Commit**

```bash
cd tukytukapi
git add controllers/trip.js tests/trip-accept-status.test.js
git commit -m "feat(backend): acceptTrip y statusTrip emiten sockets y validan rejectedBy"
```

---

## Tarea 5: Handler socket location-update

**Files:**
- Modify: `tukytukapi/sockets/socket.js`

**Interfaces:**
- Consumes: `io` (export de `index.js`), `Trip` (modelo Mongoose).
- Produces: handler que escucha `location-update` del cliente, valida pertenencia al viaje y re-emite a la contraparte con `{ tripId, role, lat, lng, ts }`. Tarea 12 (Flutter) emite y consume.

- [ ] **Paso 1: Modificar `sockets/socket.js`**

Reemplazar el contenido por:

```js
const { io } = require('../index');
const { comprobarJWT } = require('../helpers/jwt');
const { usuarioConectado, usuarioDesconectado, grabarMensaje } = require('../controllers/socket');
const Trip = require('../models/trip');

io.on('connection', (client) => {
    const [valido, uid] = comprobarJWT(client.handshake.headers['x-token']);

    if (!valido) { return client.disconnect(); }

    usuarioConectado(uid);
    client.join(uid);

    client.on('mensaje-personal', async (payload) => {
        await grabarMensaje(payload);
        io.to(payload.para).emit('mensaje-personal', payload);
    });

    client.on('location-update', async ({ tripId, lat, lng }) => {
        try {
            if (!tripId || lat == null || lng == null) return;
            const trip = await Trip.findById(tripId).lean();
            if (!trip) return;
            if (trip.user_status === 'C' || trip.user_status === 'F') return;

            const isUser = String(trip.usuario) === String(uid);
            const isDriver = String(trip.driver) === String(uid);
            if (!isUser && !isDriver) return;

            const counterpart = isUser ? trip.driver : trip.usuario;
            if (!counterpart) return;

            const role = isUser ? 'passenger' : 'driver';
            io.to(String(counterpart)).emit('location-update', {
                tripId,
                role,
                lat,
                lng,
                ts: Date.now()
            });
        } catch (err) {
            console.warn('location-update fail', err.message);
        }
    });

    client.on('disconnect', () => {
        usuarioDesconectado(uid);
    });
});
```

- [ ] **Paso 2: Verificación manual con dos clientes**

Levantar el backend y con dos shells abrir conexiones socket.io autenticadas como pasajero y conductor de un viaje activo. Emitir desde el conductor:

```js
socket.emit('location-update', { tripId: '<id>', lat: 14.61, lng: -90.52 });
```

Esperado: el cliente del pasajero recibe el evento `location-update` con `role: 'driver'`.

Si no se puede setup en este momento, dejar la verificación para la Tarea 13 (golden path manual).

- [ ] **Paso 3: Commit**

```bash
cd tukytukapi
git add sockets/socket.js
git commit -m "feat(backend): handler socket location-update con validacion de viaje"
```

---

## Tarea 6: Mapbox token a `.env` y Constants

**Files:**
- Modify: `tukytuk/.env` (si existe) y/o `tukytuk/.env.example`
- Modify: `tukytuk/lib/const/general.dart`
- Modify: `tukytuk/lib/services/places_intercerptor.dart`

**Interfaces:**
- Produces: `Constants.mapboxToken` accesible desde cualquier parte del cliente. Si `.env` no carga, el getter devuelve string vacío y el `SearchBloc` reacciona como error en Tarea 7.

- [ ] **Paso 1: Confirmar dependencia `flutter_dotenv`**

```bash
cd tukytuk
grep flutter_dotenv pubspec.yaml
```

Esperado: aparece. Si no, agregar a `dependencies` con la última versión estable y `flutter pub get`.

- [ ] **Paso 2: Agregar `MAPBOX_TOKEN` a `.env` y `.env.example`**

Editar `tukytuk/.env.example` y agregar (sin valor real):

```
MAPBOX_TOKEN=
```

Editar `tukytuk/.env` (no commitear, va a `.gitignore`) y poner el token actual:

```
MAPBOX_TOKEN=pk.eyJ1...   # el token vigente
```

- [ ] **Paso 3: Exponer `Constants.mapboxToken`**

Editar `tukytuk/lib/const/general.dart`. Agregar al `Constants`:

```dart
static String get mapboxToken => dotenv.env['MAPBOX_TOKEN'] ?? '';
```

Asegurarse de que `import 'package:flutter_dotenv/flutter_dotenv.dart';` está presente al inicio.

- [ ] **Paso 4: Leer token desde Constants en el interceptor**

Editar `tukytuk/lib/services/places_intercerptor.dart`. Reemplazar el token hardcoded por:

```dart
options.queryParameters['access_token'] = Constants.mapboxToken;
```

(Si el archivo lee el token de otra forma, ajustar pero el principio es: nunca volver a hardcodear.)

- [ ] **Paso 5: Verificar que la app compila**

```bash
cd tukytuk
flutter analyze
```

Esperado: sin warnings nuevos relativos a estos archivos.

- [ ] **Paso 6: Commit**

```bash
cd tukytuk
git add .env.example lib/const/general.dart lib/services/places_intercerptor.dart
# .env va en .gitignore, no se commitea
git commit -m "chore(flutter): mapbox token desde .env via Constants"
```

---

## Tarea 7: SearchBloc — estados loading/ok/failed y manejo de errores

**Files:**
- Modify: `tukytuk/lib/blocs/search/search_state.dart`
- Modify: `tukytuk/lib/blocs/search/search_bloc.dart`
- Test: `tukytuk/test/search_bloc_test.dart` (crear)

**Interfaces:**
- Consumes: `TrafficService.getResultsByQuery` (existente).
- Produces: `SearchState` con `status: SearchStatus { initial, loading, ok, failed }` y `failureReason: String?`. La pantalla del delegate (Tarea 8) los consume.

- [ ] **Paso 1: Inspeccionar el estado actual**

Leer `tukytuk/lib/blocs/search/search_state.dart` y `search_bloc.dart` para entender el shape actual. Mantener compatibilidad con consumidores existentes (probablemente `displayManual` y `places`).

- [ ] **Paso 2: Crear el test (failing)**

Crear `tukytuk/test/search_bloc_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tukytuk/blocs/search/search_bloc.dart';

void main() {
  test('estado inicial es SearchStatus.initial', () {
    final bloc = SearchBloc();
    expect(bloc.state.status, SearchStatus.initial);
    expect(bloc.state.failureReason, isNull);
  });

  test('SearchStatus.failed con reason cuando getPlacesByQuery falla', () async {
    // Test con un servicio que siempre lanza para validar el manejo de error.
    // Si SearchBloc instancia TrafficService internamente, marcar como TODO
    // y volver acá tras Tarea 7 si hace falta inyectar.
  }, skip: 'requiere refactor de inyección de TrafficService — opcional');
}
```

- [ ] **Paso 3: Modificar `SearchState`**

Agregar:

```dart
enum SearchStatus { initial, loading, ok, failed }

class SearchState {
  // ... campos existentes
  final SearchStatus status;
  final String? failureReason;

  const SearchState({
    // ... existentes
    this.status = SearchStatus.initial,
    this.failureReason,
  });

  SearchState copyWith({
    // ... existentes
    SearchStatus? status,
    String? failureReason,
  }) => SearchState(
    // ... existentes
    status: status ?? this.status,
    failureReason: failureReason,  // siempre se reemplaza (puede ser null intencional)
  );
}
```

- [ ] **Paso 4: Envolver `getPlacesByQuery` con try/catch**

En `search_bloc.dart`:

```dart
Future getPlacesByQuery(LatLng proximity, String query) async {
  emit(state.copyWith(status: SearchStatus.loading, failureReason: null));
  try {
    final places = await trafficService.getResultsByQuery(proximity, query);
    emit(state.copyWith(places: places, status: SearchStatus.ok));
  } on DioException catch (e) {
    emit(state.copyWith(
      status: SearchStatus.failed,
      failureReason: _mapDioError(e),
    ));
  } catch (_) {
    emit(state.copyWith(
      status: SearchStatus.failed,
      failureReason: 'No pudimos buscar direcciones. Coloca tu destino manualmente.',
    ));
  }
}

String _mapDioError(DioException e) {
  final status = e.response?.statusCode;
  if (status == 401 || status == 403) {
    return 'Servicio de búsqueda no disponible. Coloca tu destino manualmente.';
  }
  if (status == 429) {
    return 'Demasiadas consultas. Intenta en un momento.';
  }
  if (e.type == DioExceptionType.connectionError) {
    return 'Sin conexión. Revisa tu internet.';
  }
  return 'No pudimos buscar direcciones. Coloca tu destino manualmente.';
}
```

Asegurarse de importar `package:dio/dio.dart`.

- [ ] **Paso 5: Correr el test del bloc**

```bash
cd tukytuk
flutter test test/search_bloc_test.dart
```

Esperado: el primer test pasa, el segundo está marcado como skip.

- [ ] **Paso 6: Analyze**

```bash
cd tukytuk
flutter analyze
```

Esperado: sin warnings nuevos.

- [ ] **Paso 7: Commit**

```bash
cd tukytuk
git add lib/blocs/search/ test/search_bloc_test.dart
git commit -m "feat(flutter): SearchBloc maneja errores de Mapbox sin colgar la app"
```

---

## Tarea 8: SearchDestinationDelegate — banner de error y opción manual destacada

**Files:**
- Modify: `tukytuk/lib/delegates/search_destination_delegate.dart`

**Interfaces:**
- Consumes: `SearchBloc.state.status` y `failureReason` (Tarea 7).

- [ ] **Paso 1: Cambiar `buildResults` para reaccionar al estado**

En `tukytuk/lib/delegates/search_destination_delegate.dart`, dentro de `buildResults`, envolver el `BlocBuilder` existente para reaccionar al estado:

```dart
@override
Widget buildResults(BuildContext context) {
  return BlocBuilder<SearchBloc, SearchState>(
    builder: (context, state) {
      if (state.status == SearchStatus.loading) {
        return const Center(child: CircularProgressIndicator());
      }
      if (state.status == SearchStatus.failed) {
        return _ErrorBanner(
          message: state.failureReason ?? 'No pudimos buscar direcciones.',
          onManualTap: () => _onManualTap(context),
        );
      }
      // Lista normal de places (código existente)
      // ... mantener el rendering actual de la lista
    },
  );
}
```

- [ ] **Paso 2: Crear widget `_ErrorBanner`**

Al final del mismo archivo:

```dart
class _ErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback onManualTap;
  const _ErrorBanner({required this.message, required this.onManualTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.red.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.red.shade200),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.red),
                const SizedBox(width: 12),
                Expanded(child: Text(message)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onManualTap,
            icon: const Icon(Icons.location_on),
            label: const Text('Colocar destino manualmente en el mapa'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Paso 3: Extraer `_onManualTap` si no existe**

Si `buildResults` ya tenía la lógica de "colocar manualmente" inline, extraerla a un método privado:

```dart
void _onManualTap(BuildContext context) {
  final result = SearchResult(manual: true, cancel: false);
  close(context, result);
}
```

- [ ] **Paso 4: Analyze**

```bash
cd tukytuk
flutter analyze
```

Esperado: sin warnings nuevos.

- [ ] **Paso 5: Smoke manual**

Forzar un error: temporalmente poner `MAPBOX_TOKEN=invalido` en `.env`, correr la app, intentar buscar una dirección. Esperado: aparece el banner rojo y el botón "Colocar destino manualmente en el mapa". Restaurar el token.

- [ ] **Paso 6: Commit**

```bash
cd tukytuk
git add lib/delegates/search_destination_delegate.dart
git commit -m "feat(flutter): banner de error en busqueda + opcion manual destacada"
```

---

## Tarea 9: TripService.cancelTrip + botón cancelar en MapScreen

**Files:**
- Modify: `tukytuk/lib/services/trip_service.dart`
- Modify: `tukytuk/lib/screens/map_screen.dart`
- Test: `tukytuk/test/btn_cancel_widget_test.dart` (crear, opcional)

**Interfaces:**
- Consumes: `PUT /api/trip/user/cancelTrip` (Tarea 2).
- Produces: `tripService.cancelTrip(String uidTrip)` que devuelve `bool` indicando éxito. La pantalla del pasajero usa el resultado para limpiar `activeTrip` y mostrar SnackBar.

- [ ] **Paso 1: Agregar `cancelTrip` a TripService**

En `tukytuk/lib/services/trip_service.dart`, agregar:

```dart
Future<bool> cancelTrip(String uidTrip) async {
  try {
    final resp = await http.put(
      Uri.parse('${Constants.apiUrl}/trip/user/cancelTrip'),
      headers: {
        'Content-Type': 'application/json',
        'x-token': (await AuthService.getToken()) ?? ''
      },
      body: jsonEncode({ 'uid_trip': uidTrip }),
    );
    if (resp.statusCode == 200) {
      final body = jsonDecode(resp.body);
      return body['ok'] == true;
    }
    return false;
  } catch (e) {
    print('cancelTrip error: $e');
    return false;
  }
}
```

- [ ] **Paso 2: Identificar la sección de FABs en `map_screen.dart`**

Abrir `tukytuk/lib/screens/map_screen.dart` y localizar el `floatingActionButton` (Column con el botón de chat). Anotar la línea exacta y el estado que controla la visibilidad (probablemente `userStatus` o `tripActivated`).

- [ ] **Paso 3: Agregar el botón Cancelar condicional**

Dentro de la Column de FABs, justo antes del botón de chat:

```dart
if (userStatus == 'S') ...[
  Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: FloatingActionButton.extended(
      heroTag: 'cancel-trip',
      backgroundColor: Colors.red,
      onPressed: () => _confirmAndCancelTrip(context, activeTripUid),
      icon: const Icon(Icons.close, color: Colors.white),
      label: const Text('Cancelar viaje', style: TextStyle(color: Colors.white)),
    ),
  ),
],
```

- [ ] **Paso 4: Implementar `_confirmAndCancelTrip`**

En el state del MapScreen:

```dart
Future<void> _confirmAndCancelTrip(BuildContext context, String uidTrip) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Cancelar viaje'),
      content: const Text('¿Cancelar la búsqueda de conductor?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('No'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Sí, cancelar'),
        ),
      ],
    ),
  );
  if (confirmed != true) return;

  final ok = await TripService().cancelTrip(uidTrip);
  if (!mounted) return;
  if (ok) {
    setState(() {
      activeTrip = null;
      userStatus = '';
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Viaje cancelado')),
    );
    Navigator.of(context).pushReplacementNamed('home_passanger');
  } else {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No se pudo cancelar, intenta de nuevo')),
    );
  }
}
```

Ajustar `activeTripUid`, `activeTrip`, `userStatus` a los nombres reales del state. La ruta de destino tras cancelar (`home_passanger` o equivalente) debe coincidir con la del proyecto.

- [ ] **Paso 5: Analyze**

```bash
cd tukytuk
flutter analyze
```

Esperado: sin warnings nuevos.

- [ ] **Paso 6: Smoke manual**

Con la app, solicitar un viaje → ver estado "Solicitando" → presionar Cancelar → confirmar → vuelve a home; en backend el `Trip` debe estar en `user_status: 'C'`.

- [ ] **Paso 7: Commit**

```bash
cd tukytuk
git add lib/services/trip_service.dart lib/screens/map_screen.dart
git commit -m "feat(flutter): boton cancelar viaje en estado solicitando"
```

---

## Tarea 10: Vista del conductor — eliminar mock data y listado real

**Files:**
- Modify: `tukytuk/lib/pages/trip_driver_page.dart`
- Modify: `tukytuk/lib/services/trip_service.dart` (agregar `rejectTrip`)

**Interfaces:**
- Consumes: `getDriverListTrip()` ya existe en TripService y ahora devuelve viajes filtrados por rejectedBy (Tarea 3).
- Produces: `tripService.rejectTrip(String uidTrip)` → `bool`. La pantalla muestra una lista refrescada cada 5s con cards de viajes reales.

- [ ] **Paso 1: Agregar `rejectTrip` a TripService**

En `trip_service.dart`:

```dart
Future<bool> rejectTrip(String uidTrip) async {
  try {
    final resp = await http.put(
      Uri.parse('${Constants.apiUrl}/trip/driver/rejectTrip'),
      headers: {
        'Content-Type': 'application/json',
        'x-token': (await AuthService.getToken()) ?? ''
      },
      body: jsonEncode({ 'uid_trip': uidTrip }),
    );
    if (resp.statusCode == 200) {
      final body = jsonDecode(resp.body);
      return body['ok'] == true;
    }
    return false;
  } catch (e) {
    print('rejectTrip error: $e');
    return false;
  }
}
```

- [ ] **Paso 2: Eliminar el mock de `trip_driver_page.dart`**

Abrir `tukytuk/lib/pages/trip_driver_page.dart`. Identificar la lista hardcoded ("Juan Pérez", "María Rodríguez"). Borrarla por completo.

- [ ] **Paso 3: Reemplazar el body con listado real**

Reescribir el `build` del `State` para usar polling cada 5s vía `Timer.periodic`:

```dart
class _TripDriverPageState extends State<TripDriverPage> {
  Timer? _timer;
  List<Trip> _trips = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final trips = await TripService().getDriverListTrip();
    if (!mounted) return;
    setState(() {
      _trips = trips;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Viajes disponibles')),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _trips.isEmpty
            ? const Center(child: Text('No hay viajes disponibles'))
            : RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  itemCount: _trips.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _TripCard(
                    trip: _trips[i],
                    onTap: () => _showPreview(_trips[i]),
                  ),
                ),
              ),
    );
  }

  void _showPreview(Trip trip) {
    // Implementado en la Tarea 11 (TripPreviewSheet)
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => TripPreviewSheet(
        trip: trip,
        onAccept: () => _acceptTrip(trip),
        onReject: () => _rejectTrip(trip),
      ),
    );
  }

  Future<void> _acceptTrip(Trip trip) async {
    // navegación al map_driver con el viaje activo; lógica existente
    Navigator.pop(context);
    // ...
  }

  Future<void> _rejectTrip(Trip trip) async {
    final ok = await TripService().rejectTrip(trip.uid);
    if (!mounted) return;
    Navigator.pop(context);
    if (ok) {
      _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo rechazar')),
      );
    }
  }
}
```

`_TripCard` es un widget privado que muestra origen/destino/distancia haversine:

```dart
class _TripCard extends StatelessWidget {
  final Trip trip;
  final VoidCallback onTap;
  const _TripCard({required this.trip, required this.onTap});

  double _haversineKm() {
    const r = 6371.0;
    final dLat = _toRad(double.parse(trip.endLat) - double.parse(trip.startLat));
    final dLng = _toRad(double.parse(trip.endLng) - double.parse(trip.startLng));
    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(_toRad(double.parse(trip.startLat))) *
            cos(_toRad(double.parse(trip.endLat))) *
            sin(dLng / 2) * sin(dLng / 2);
    final c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return r * c;
  }

  double _toRad(double d) => d * pi / 180;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text('Viaje a ${trip.endLat}, ${trip.endLng}'),
      subtitle: Text('${_haversineKm().toStringAsFixed(1)} km estimados'),
      trailing: ElevatedButton(onPressed: onTap, child: const Text('Ver ruta')),
    );
  }
}
```

Asegurarse de importar `dart:async`, `dart:math`, `package:tukytuk/widgets/trip_preview_sheet.dart` (existirá tras Tarea 11), `package:tukytuk/models/trip.dart`, `package:tukytuk/services/trip_service.dart`.

- [ ] **Paso 4: Analyze**

```bash
cd tukytuk
flutter analyze lib/pages/trip_driver_page.dart
```

Esperado: solo warnings de import de `TripPreviewSheet` (vendrá en Tarea 11). El resto sin warnings.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk
git add lib/pages/trip_driver_page.dart lib/services/trip_service.dart
git commit -m "feat(flutter): trip_driver_page muestra viajes reales en lugar de mock"
```

---

## Tarea 11: TripPreviewSheet con polyline, tiempo, distancia y botones aceptar/rechazar

**Files:**
- Create: `tukytuk/lib/widgets/trip_preview_sheet.dart`

**Interfaces:**
- Consumes: `SearchBloc.getCoorsStartToEnd(start, end)` (ya existe, devuelve `{duration, distance, points}`).
- Produces: `TripPreviewSheet` widget con `{ trip, onAccept, onReject }` props.

- [ ] **Paso 1: Crear el widget**

Crear `tukytuk/lib/widgets/trip_preview_sheet.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:tukytuk/blocs/search/search_bloc.dart';
import 'package:tukytuk/models/trip.dart';

class TripPreviewSheet extends StatefulWidget {
  final Trip trip;
  final Future<void> Function() onAccept;
  final Future<void> Function() onReject;

  const TripPreviewSheet({
    super.key,
    required this.trip,
    required this.onAccept,
    required this.onReject,
  });

  @override
  State<TripPreviewSheet> createState() => _TripPreviewSheetState();
}

class _TripPreviewSheetState extends State<TripPreviewSheet> {
  bool _loading = true;
  bool _failed = false;
  double? _distanceKm;
  double? _durationMin;
  List<LatLng> _route = [];

  @override
  void initState() {
    super.initState();
    _loadRoute();
  }

  Future<void> _loadRoute() async {
    try {
      final start = LatLng(
        double.parse(widget.trip.startLat),
        double.parse(widget.trip.startLng),
      );
      final end = LatLng(
        double.parse(widget.trip.endLat),
        double.parse(widget.trip.endLng),
      );
      final result = await context
          .read<SearchBloc>()
          .getCoorsStartToEnd(start, end);
      if (!mounted) return;
      setState(() {
        _route = result.points;
        _distanceKm = result.distance / 1000;
        _durationMin = result.duration / 60;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() { _failed = true; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return SizedBox(
      height: media.size.height * 0.85,
      child: Column(
        children: [
          Container(
            margin: const EdgeInsets.symmetric(vertical: 8),
            width: 40, height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.shade400,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Expanded(child: _buildMap()),
          _buildMetrics(),
          const Divider(height: 1),
          _buildActions(),
        ],
      ),
    );
  }

  Widget _buildMap() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_failed || _route.isEmpty) {
      return const Center(child: Text('No se pudo cargar la ruta'));
    }
    return FlutterMap(
      options: MapOptions(
        center: _route.first,
        zoom: 13,
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.tukytuk.app',
        ),
        PolylineLayer(polylines: [
          Polyline(points: _route, strokeWidth: 4, color: Colors.blue),
        ]),
        MarkerLayer(markers: [
          Marker(point: _route.first, child: const Icon(Icons.my_location, color: Colors.green)),
          Marker(point: _route.last, child: const Icon(Icons.location_on, color: Colors.red)),
        ]),
      ],
    );
  }

  Widget _buildMetrics() {
    final distance = _distanceKm == null ? '—' : '${_distanceKm!.toStringAsFixed(1)} km';
    final duration = _durationMin == null ? '—' : '${_durationMin!.toStringAsFixed(0)} min';
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          Column(children: [const Text('Distancia'), Text(distance, style: const TextStyle(fontWeight: FontWeight.bold))]),
          Column(children: [const Text('Tiempo'), Text(duration, style: const TextStyle(fontWeight: FontWeight.bold))]),
        ],
      ),
    );
  }

  Widget _buildActions() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: widget.onReject,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                minimumSize: const Size.fromHeight(56),
              ),
              child: const Text('Rechazar', style: TextStyle(color: Colors.white)),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton(
              onPressed: widget.onAccept,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                minimumSize: const Size.fromHeight(56),
              ),
              child: const Text('Aceptar', style: TextStyle(color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }
}
```

Si `getCoorsStartToEnd` no devuelve un objeto con `points/distance/duration`, ajustar al shape real (verificar en `search_bloc.dart:30-54`). El plan asume ese contrato; si no coincide, el implementador adapta.

- [ ] **Paso 2: Conectar `onAccept` en `trip_driver_page.dart`**

Completar `_acceptTrip` de la Tarea 10. Probablemente:

```dart
Future<void> _acceptTrip(Trip trip) async {
  final pos = /* leer ubicación actual del LocationBloc */;
  final updated = await TripService().setDriverAcceptTrip(
    trip.uid, pos.latitude.toString(), pos.longitude.toString(),
  );
  if (!mounted) return;
  Navigator.pop(context); // cierra el bottom sheet
  if (updated != null && updated.uid.isNotEmpty) {
    Navigator.of(context).pushReplacementNamed('map_driver');
  } else {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No se pudo aceptar el viaje')),
    );
  }
}
```

Verificar nombres de bloc/método de ubicación en el proyecto y la ruta destino.

- [ ] **Paso 3: Analyze**

```bash
cd tukytuk
flutter analyze
```

Esperado: sin warnings nuevos.

- [ ] **Paso 4: Smoke manual**

Con un pasajero solicitando un viaje, abrir la app del conductor → tap en card "Ver ruta" → debe abrirse el sheet con el mapa, la polyline, distancia, tiempo, botones rojo (rechazar) y verde (aceptar). Rechazar → el viaje desaparece de la lista al refrescar.

- [ ] **Paso 5: Commit**

```bash
cd tukytuk
git add lib/widgets/trip_preview_sheet.dart lib/pages/trip_driver_page.dart
git commit -m "feat(flutter): trip_preview_sheet con ruta tiempo y distancia para conductor"
```

---

## Tarea 12: SocketService — listeners trip-accepted, trip-status-changed, location-update y helpers de emisión

**Files:**
- Modify: `tukytuk/lib/services/socket_service.dart`

**Interfaces:**
- Consumes: eventos `trip-accepted`, `trip-status-changed`, `location-update` del backend (Tareas 4 y 5).
- Produces: streams públicos `Stream<dynamic> tripAcceptedStream`, `tripStatusChangedStream`, `locationUpdatesStream` y métodos `startEmittingLocation(String tripId, String role)` y `stopEmittingLocation()`. Tarea 13 los consume.

- [ ] **Paso 1: Agregar streams y helpers a `SocketService`**

Reemplazar el archivo por:

```dart
// ignore_for_file: constant_identifier_names, library_prefixes

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:tukytuk/const/general.dart';
import 'package:tukytuk/services/auth_service.dart';

enum ServerStatus { Online, Offline, Connecting }

class SocketService with ChangeNotifier {
  ServerStatus _serverStatus = ServerStatus.Connecting;
  late IO.Socket _socket;

  final _tripAcceptedCtrl = StreamController<Map<String, dynamic>>.broadcast();
  final _tripStatusChangedCtrl = StreamController<Map<String, dynamic>>.broadcast();
  final _locationUpdatesCtrl = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get tripAcceptedStream => _tripAcceptedCtrl.stream;
  Stream<Map<String, dynamic>> get tripStatusChangedStream => _tripStatusChangedCtrl.stream;
  Stream<Map<String, dynamic>> get locationUpdatesStream => _locationUpdatesCtrl.stream;

  Timer? _emissionTimer;
  StreamSubscription<Position>? _positionSub;
  Position? _lastEmittedPosition;
  String? _activeTripId;

  ServerStatus get serverStatus => _serverStatus;
  IO.Socket get socket => _socket;
  Function get emit => _socket.emit;

  void connect() async {
    final token = await AuthService.getToken();
    _socket = IO.io(Constants.socketUrl, {
      'transports': ['websocket'],
      'autoConnect': true,
      'forceNew': true,
      'extraHeaders': {'x-token': token}
    });

    _socket.on('connect', (_) {
      _serverStatus = ServerStatus.Online;
      notifyListeners();
    });

    _socket.on('disconnect', (_) {
      _serverStatus = ServerStatus.Offline;
      notifyListeners();
    });

    _socket.on('trip-accepted', (data) {
      if (data is Map) _tripAcceptedCtrl.add(Map<String, dynamic>.from(data));
    });

    _socket.on('trip-status-changed', (data) {
      if (data is Map) _tripStatusChangedCtrl.add(Map<String, dynamic>.from(data));
    });

    _socket.on('location-update', (data) {
      if (data is Map) _locationUpdatesCtrl.add(Map<String, dynamic>.from(data));
    });
  }

  void disconnect() {
    stopEmittingLocation();
    _socket.disconnect();
  }

  Future<void> startEmittingLocation(String tripId, String role) async {
    _activeTripId = tripId;
    _lastEmittedPosition = null;

    _emissionTimer?.cancel();
    _emissionTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      try {
        final pos = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
        );
        final last = _lastEmittedPosition;
        if (last != null) {
          final movedMeters = Geolocator.distanceBetween(
            last.latitude, last.longitude, pos.latitude, pos.longitude);
          if (movedMeters < 10) return;
        }
        _lastEmittedPosition = pos;
        _socket.emit('location-update', {
          'tripId': _activeTripId,
          'lat': pos.latitude,
          'lng': pos.longitude,
        });
      } catch (e) {
        debugPrint('emit location err: $e');
      }
    });
  }

  void stopEmittingLocation() {
    _emissionTimer?.cancel();
    _emissionTimer = null;
    _positionSub?.cancel();
    _positionSub = null;
    _activeTripId = null;
    _lastEmittedPosition = null;
  }

  @override
  void dispose() {
    _emissionTimer?.cancel();
    _positionSub?.cancel();
    _tripAcceptedCtrl.close();
    _tripStatusChangedCtrl.close();
    _locationUpdatesCtrl.close();
    super.dispose();
  }
}
```

Verificar que `geolocator` esté en `pubspec.yaml` (es muy probable porque la app ya pide GPS). Si no, agregarlo.

- [ ] **Paso 2: Analyze**

```bash
cd tukytuk
flutter analyze lib/services/socket_service.dart
```

Esperado: sin warnings nuevos.

- [ ] **Paso 3: Smoke manual con DevTools**

Levantar la app, autenticar como conductor, llamar manualmente `startEmittingLocation('test-trip', 'driver')` desde un debug button temporal o probando en `MapDriverScreen` (próxima tarea). Confirmar en los logs del backend que llegan eventos `location-update`.

(Si no hay forma rápida de hacerlo aislado, dejar la prueba para la Tarea 13.)

- [ ] **Paso 4: Commit**

```bash
cd tukytuk
git add lib/services/socket_service.dart
git commit -m "feat(flutter): socket service expone streams y emite ubicacion cada 3s"
```

---

## Tarea 13: Integración en MapScreen (pasajero) y MapDriverScreen, polling a 5s

**Files:**
- Modify: `tukytuk/lib/screens/map_screen.dart`
- Modify: `tukytuk/lib/screens/map_driver_screen.dart`

**Interfaces:**
- Consumes: `SocketService.tripAcceptedStream`, `tripStatusChangedStream`, `locationUpdatesStream`, `startEmittingLocation`, `stopEmittingLocation` (Tarea 12).

- [ ] **Paso 1: MapScreen del pasajero — listener `trip-accepted`**

En `map_screen.dart`, en `initState`:

```dart
late StreamSubscription _acceptedSub;
late StreamSubscription _statusSub;
late StreamSubscription _locUpdSub;
LatLng? _driverPosition;

@override
void initState() {
  super.initState();
  final socket = context.read<SocketService>();

  _acceptedSub = socket.tripAcceptedStream.listen((data) async {
    if (!mounted) return;
    final tripFromEvent = data['trip'];
    setState(() {
      activeTrip = Trip.fromJson(tripFromEvent); // ajustar al constructor real
      userStatus = 'A';
    });
    await socket.startEmittingLocation(activeTrip.uid, 'passenger');
  });

  _statusSub = socket.tripStatusChangedStream.listen((data) {
    if (!mounted) return;
    setState(() {
      userStatus = data['user_status'];
    });
    if (data['driver_status'] == 'F') {
      socket.stopEmittingLocation();
    }
  });

  _locUpdSub = socket.locationUpdatesStream.listen((data) {
    if (data['role'] != 'driver') return;
    if (!mounted) return;
    setState(() {
      _driverPosition = LatLng(
        (data['lat'] as num).toDouble(),
        (data['lng'] as num).toDouble(),
      );
    });
  });
}

@override
void dispose() {
  _acceptedSub.cancel();
  _statusSub.cancel();
  _locUpdSub.cancel();
  context.read<SocketService>().stopEmittingLocation();
  super.dispose();
}
```

- [ ] **Paso 2: Mostrar marcador del conductor en el mapa del pasajero**

Dentro del widget del mapa (probablemente un `GoogleMap` o `FlutterMap`), agregar un marcador condicional cuando `_driverPosition != null`:

```dart
if (_driverPosition != null)
  Marker(
    markerId: const MarkerId('driver'),
    position: _driverPosition!,
    icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
  ),
```

(Ajustar al tipo de mapa que use ese widget.)

- [ ] **Paso 3: MapDriverScreen — emitir ubicación y mostrar pasajero**

En `map_driver_screen.dart`, mismo patrón en `initState`:

```dart
late StreamSubscription _locUpdSub;
LatLng? _passengerPosition;

@override
void initState() {
  super.initState();
  final socket = context.read<SocketService>();
  socket.startEmittingLocation(widget.activeTrip.uid, 'driver');

  _locUpdSub = socket.locationUpdatesStream.listen((data) {
    if (data['role'] != 'passenger') return;
    if (!mounted) return;
    setState(() {
      _passengerPosition = LatLng(
        (data['lat'] as num).toDouble(),
        (data['lng'] as num).toDouble(),
      );
    });
  });
}

@override
void dispose() {
  _locUpdSub.cancel();
  context.read<SocketService>().stopEmittingLocation();
  super.dispose();
}
```

Y mostrar el marcador del pasajero cuando `_passengerPosition != null`.

- [ ] **Paso 4: Bajar polling a 5s**

En ambos archivos, localizar `Timer.periodic(Duration(milliseconds: 2000), ...)` y cambiar a `const Duration(seconds: 5)`.

- [ ] **Paso 5: Analyze**

```bash
cd tukytuk
flutter analyze lib/screens/map_screen.dart lib/screens/map_driver_screen.dart
```

Esperado: sin warnings nuevos.

- [ ] **Paso 6: Commit**

```bash
cd tukytuk
git add lib/screens/map_screen.dart lib/screens/map_driver_screen.dart
git commit -m "feat(flutter): ubicacion en vivo bidireccional y polling reducido a 5s"
```

---

## Tarea 14: Verificación manual del golden path

**Files:**
- Ninguno. Es un checkpoint humano.

**Interfaces:**
- Consumes: todo lo implementado en las tareas 1–13.

- [ ] **Paso 1: Setup**

- Backend dev corriendo (`npm run start:dev` con MongoDB local).
- App Flutter compilada en dos dispositivos (o emulador + dispositivo): uno con cuenta de pasajero (`type: 'U'`), otro con cuenta de conductor (`type: 'C'`).

- [ ] **Paso 2: Recorrer cada flujo y marcar resultado**

Ejecutar y marcar cada criterio:

- [ ] (1) **Autocomplete con error simulado:** invalidar el token Mapbox en `.env` y reiniciar la app del pasajero. Buscar una dirección. **Esperado:** banner rojo + botón "Colocar destino manualmente en el mapa". App no crashea.
- [ ] (2) **Cancelar mientras busca:** restaurar token. Pasajero solicita, ve "Solicitando", presiona Cancelar, confirma. **Esperado:** vuelve a home; verificar en MongoDB que el Trip quedó en `user_status: 'C'` y `cancelledAt` está poblado.
- [ ] (3) **Conductor ve viaje real:** pasajero solicita otro viaje. Conductor abre la app. **Esperado:** ve el viaje real en la lista (no "Juan Pérez"). Tap en "Ver ruta" → BottomSheet con polyline, tiempo y distancia.
- [ ] (4) **Conductor rechaza:** rechazar el viaje. **Esperado:** el viaje desaparece de la lista del conductor. Otro conductor (segundo dispositivo o usar otra cuenta) SÍ lo ve.
- [ ] (5) **Conductor acepta:** primer conductor acepta otro viaje del pasajero. **Esperado:** el pasajero ve cambio de estado a "Conductor en camino" en menos de 1s (vía socket).
- [ ] (6) **Viaje en curso:** conductor cambia status a "P" (iniciar viaje). **Esperado:** ambos ven al otro moverse en el mapa con latencia ≤ 3s.
- [ ] (7) **Finalización:** conductor cambia status a "F". **Esperado:** ambos vuelven a su pantalla principal limpia.

- [ ] **Paso 3: Marcar la sección "Criterios de aceptación" del spec**

Editar `tukytukapi/docs/superpowers/specs/2026-06-17-flujo-viaje-design.md` y marcar los checkboxes de la sección 9 según corresponda.

- [ ] **Paso 4: Commit del marcado del spec**

```bash
cd tukytukapi
git add docs/superpowers/specs/2026-06-17-flujo-viaje-design.md
git commit -m "docs(backend): marcar criterios de aceptacion del flujo de viaje"
```

---

## Notas finales

- **Compatibilidad de polling:** mantenemos los timers a 5s como red de seguridad por si los sockets se caen brevemente. Si en una iteración futura se confirma estabilidad, se puede subir a 15s o eliminar.
- **Bugs preexistentes detectados pero NO arreglados aquí:** `controllers/trip.js:44` (`req.params.uid .uid`), `controllers/trip.js:159` (`usuario.findOne` con minúsculas), `getDriverActiveTrip` ignora `req.params.uid`. Anotar como issues separados si se quiere atacar luego.
- **Manejo de errores de TripService en Flutter:** se mantiene el patrón existente de devolver objetos "vacíos" en lugar de `null`/excepciones para no romper otros consumidores. En una iteración futura sería bueno introducir `Result<Trip, Error>` pero está fuera de alcance de este plan.
