# Spec 2 — Suscripción mensual de conductores

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Backend (`tukytukapi/`) + App Flutter (`tukytuk/`) + Admin Web (`tukytuk-admin/`)

## 1. Objetivo

Que solo los conductores con el pago al día puedan ponerse en línea y recibir viajes. El admin gestiona los pagos (revisión de comprobantes y creación manual para casos especiales).

### Flujo en una línea

El conductor sube comprobante (foto) → admin lo revisa → admin aprueba o rechaza con comentario → si está aprobado y vigente, el conductor puede activarse.

## 2. Principios

- **Snapshot de precio y duración por pago.** Si el admin cambia el precio mañana, los pagos viejos no se ven afectados. Cada `Payment` guarda el monto y los días con los que fue creado.
- **Acumulación al renovar.** Si el conductor todavía tiene vigencia y aprueba otro pago, el nuevo arranca cuando vence el anterior. No se pierden días por pagar anticipado.
- **Dos rutas para crear un pago:**
  - (a) Conductor sube comprobante (`status: 'pendiente'` → `aprobado` / `rechazado`).
  - (b) Admin crea uno manualmente con comentario, opcionalmente sin foto (`status: 'aprobado'` directo).
  Se distinguen por `createdBy`.
- **Gate único: el modelo `Payment`.** Ningún flujo decide localmente si el conductor está al día. Se calcula con un query a `Payment` con índice.

## 3. Fuera de alcance

- Push notifications (Firebase Cloud Messaging).
- Integración con pasarela de pago real (Stripe, PayPal, recibo electrónico bancario automático).
- Descuentos por referidos, planes anuales.
- Recordatorios automáticos por email cuando se acerca el vencimiento.
- "Desaprobar" un pago aprobado por error.
- Verificación con OCR del contenido del comprobante.

## 4. Modelo de datos

### 4.1 Nuevo modelo `tukytukapi/models/payment.js`

```js
const PaymentSchema = new Schema({
  driver: { type: String, required: true, index: true },   // uid del conductor
  amount: { type: Number, required: true },                // snapshot del monto
  durationDays: { type: Number, required: true },          // snapshot de duración
  status: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado'],
    default: 'pendiente',
    index: true,
  },
  createdBy: {
    type: String,
    enum: ['driver', 'admin'],
    required: true,
  },
  receiptUrl: { type: String },          // foto del comprobante (cuando aplica)
  adminComment: { type: String },        // comentario del admin (creación o rechazo)
  reviewedBy: { type: String },          // uid del admin que aprobó/rechazó
  reviewedAt: { type: Date },
  startsAt: { type: Date },              // se setea al aprobar
  expiresAt: { type: Date },             // startsAt + durationDays
}, { timestamps: true });

PaymentSchema.index({ driver: 1, status: 1, expiresAt: -1 });
```

`toJSON` debe omitir `_id`/`__v` y exponer `uid` para mantener la convención del proyecto.

**Validación en el controller** (no en el schema, porque depende de quién lo crea):

- Si `createdBy === 'driver'` → `receiptUrl` requerido.
- Si `createdBy === 'admin'` → `adminComment` requerido. `receiptUrl` opcional.
- Si `status === 'rechazado'` → `adminComment` requerido.

### 4.2 Nuevo modelo `tukytukapi/models/settings.js` (documento único)

```js
const SettingsSchema = new Schema({
  driverMonthlyPrice: { type: Number, required: true, default: 200 },
  driverMonthlyDurationDays: { type: Number, required: true, default: 30 },
  currency: { type: String, default: 'GTQ' },
}, { timestamps: true });
```

Patrón de documento único: si no existe, el backend lo crea con defaults la primera vez que se consulta.

### 4.3 Cambios al modelo `tukytukapi/models/driver.js`

Dos campos opcionales para el override por conductor:

```js
specialPrice: { type: Number },              // si se llena, anula el precio base
specialDurationDays: { type: Number },       // si se llena, anula la duración base
```

Si están vacíos, se usa `Settings`.

### 4.4 Helper `tukytukapi/helpers/driverPayment.js`

```js
async function getSettings() {
  let s = await Settings.findOne({});
  if (!s) s = await Settings.create({});
  return s;
}

async function getDriverPrice(driver) {
  const settings = await getSettings();
  return {
    amount: driver.specialPrice ?? settings.driverMonthlyPrice,
    durationDays: driver.specialDurationDays ?? settings.driverMonthlyDurationDays,
    currency: settings.currency,
  };
}

async function isDriverPaid(driverUid) {
  const now = new Date();
  const active = await Payment.findOne({
    driver: driverUid,
    status: 'aprobado',
    expiresAt: { $gt: now },
  }).sort({ expiresAt: -1 });
  return active !== null;
}

async function getNextStartsAt(driverUid) {
  const latest = await Payment.findOne({
    driver: driverUid,
    status: 'aprobado',
  }).sort({ expiresAt: -1 });
  const now = new Date();
  if (!latest || latest.expiresAt <= now) return now;
  return latest.expiresAt;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = { getSettings, getDriverPrice, isDriverPaid, getNextStartsAt, addDays };
```

### 4.5 Por qué un modelo `Payment` y no un campo `paidUntil` en `Driver`

- Necesitamos historial (qué pagos hay, quién los aprobó, cuándo, comprobantes).
- Permite al admin ver pendientes sin escanear todos los conductores.
- El gate `isDriverPaid` es un query con índice, casi instantáneo.
- Si en el futuro se hacen reportes financieros, los datos ya están estructurados.

## 5. Endpoints REST

### 5.1 Infraestructura de uploads

Dependencia nueva: `multer`.

Carpeta: `tukytukapi/uploads/payments/` (en `.gitignore`). Permisos solo del proceso Node.

`tukytukapi/helpers/upload.js`:

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
  },
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
  limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB
});
```

Servir archivos con auth: ruta `GET /api/payments/receipt/:filename` que valida JWT y autoriza:
- El conductor solo puede ver sus propios comprobantes.
- El admin (middleware `validarAdmin`, ya existente) puede ver cualquier comprobante.

No usamos `express.static` directamente sobre `uploads/` porque eso saltaría la auth.

### 5.2 Endpoints del conductor

#### `POST /api/payments/driver/upload`

- **Auth:** JWT + `type === 'C'`.
- **Body:** `multipart/form-data` con campo `receipt`.
- **Lógica:** multer guarda el archivo, controller crea `Payment` con `status: 'pendiente'`, `createdBy: 'driver'`, `receiptUrl: '/api/payments/receipt/<filename>'`, `amount`/`durationDays` snapshoteados de `getDriverPrice(driver)`.
- **Respuesta:** `{ ok: true, payment }`.
- **Errores manejados:** > 5MB, tipo no permitido, sin archivo, error de disco. Devuelven 400 con `msg` legible.

#### `GET /api/payments/driver/list`

- **Auth:** JWT + `type === 'C'`.
- **Lógica:** lista los pagos del conductor autenticado, ordenados por `createdAt` desc.
- **Respuesta:** `{ ok: true, payments }`.

#### `GET /api/payments/driver/status`

- **Auth:** JWT + `type === 'C'`.
- **Lógica:** devuelve si está al día, el pago activo (si existe) y el precio actual del conductor.
- **Respuesta:** `{ ok: true, paid, activePayment, price: { amount, durationDays, currency } }`.

#### `GET /api/payments/receipt/:filename`

- **Auth:** JWT.
- **Lógica:** busca el `Payment` cuyo `receiptUrl` contiene el `filename`. Autoriza si el solicitante es dueño o admin. Sirve el archivo desde disco.
- **Respuesta:** binario imagen, 403 si no autorizado, 404 si no existe.

### 5.3 Endpoints del admin

Todos requieren middleware `validarAdmin` (ya existe).

#### `GET /api/payments/admin/list`

- **Query params:** `status?`, `driverUid?`, `page?`, `limit?`.
- **Respuesta:** `{ ok: true, payments, total, page, limit }`.

#### `PUT /api/payments/admin/:id/approve`

- **Lógica:**
  - Carga el pago. Si no está `pendiente` → 409.
  - `startsAt = getNextStartsAt(payment.driver)` (acumula si hay vigencia activa).
  - `expiresAt = addDays(startsAt, payment.durationDays)`.
  - `status: 'aprobado'`, `reviewedBy: req.uid`, `reviewedAt: now`.
- **Side-effects socket:** `io.to(payment.driver).emit('payment-approved', { payment })`.
- **Respuesta:** `{ ok: true, payment }`.

#### `PUT /api/payments/admin/:id/reject`

- **Body:** `{ adminComment: string }` (requerido, ≥ 3 caracteres).
- **Lógica:**
  - Carga el pago. Si no está `pendiente` → 409.
  - `status: 'rechazado'`, `adminComment`, `reviewedBy`, `reviewedAt`.
- **Side-effects socket:** `io.to(payment.driver).emit('payment-rejected', { payment })`.
- **Respuesta:** `{ ok: true, payment }`.

#### `POST /api/payments/admin/create`

Pago manual del admin, para conductores existentes y casos especiales.

- **Body:** `{ driverUid, adminComment, amount?, durationDays?, receipt? }` (multipart si viene foto).
- **Lógica:**
  - Valida que `driverUid` exista y sea conductor.
  - `adminComment` requerido (≥ 3 caracteres).
  - Si `amount`/`durationDays` no vienen, usa `getDriverPrice(driver)`.
  - `startsAt = getNextStartsAt(driverUid)`, `expiresAt = addDays(startsAt, durationDays)`.
  - Crea `Payment` con `status: 'aprobado'`, `createdBy: 'admin'`, `reviewedBy: req.uid`, `reviewedAt: now`. Si vino `receipt`, multer lo guarda.
- **Side-effects socket:** `payment-approved`.
- **Respuesta:** `{ ok: true, payment }`.

#### `GET /api/payments/admin/settings` / `PUT /api/payments/admin/settings`

Lectura y upsert del documento único de `Settings`.

#### `PUT /api/users/admin/:driverUid/special-pricing`

- **Body:** `{ specialPrice?, specialDurationDays? }`. Mandar `null` borra el override.
- **Lógica:** actualiza esos campos en `Driver`.
- **Respuesta:** `{ ok: true, driver }`.

### 5.4 Gate en "ponerse en línea"

El campo `Usuario.online` existe. Asumo (o agregaremos) `PUT /api/usuarios/online` que lo cambia.

- Si el usuario es conductor (`type === 'C'`) y `online: true` → llamar `isDriverPaid(uid)`. Si `false` → **402 Payment Required** con `{ ok: false, msg: 'mensualidad_vencida', price: { amount, durationDays, currency } }`.
- Si el usuario no es conductor o `online: false` → comportamiento normal.

La app interpreta el 402 y muestra el modal bloqueante (sección 6.2).

### 5.5 Resumen tabular

| Método | Ruta | Auth |
|---|---|---|
| `POST` | `/api/payments/driver/upload` | Conductor |
| `GET` | `/api/payments/driver/list` | Conductor |
| `GET` | `/api/payments/driver/status` | Conductor |
| `GET` | `/api/payments/receipt/:filename` | Conductor (propio) o Admin |
| `GET` | `/api/payments/admin/list` | Admin |
| `PUT` | `/api/payments/admin/:id/approve` | Admin |
| `PUT` | `/api/payments/admin/:id/reject` | Admin |
| `POST` | `/api/payments/admin/create` | Admin |
| `GET` | `/api/payments/admin/settings` | Admin |
| `PUT` | `/api/payments/admin/settings` | Admin |
| `PUT` | `/api/users/admin/:driverUid/special-pricing` | Admin |

## 6. Cambios en la app Flutter

### 6.1 Servicio nuevo

`tukytuk/lib/services/payment_service.dart`:

```dart
class PaymentService {
  Future<PaymentStatus> getStatus();              // GET /driver/status
  Future<List<Payment>> getList();                // GET /driver/list
  Future<Payment> uploadReceipt(File image);      // POST /driver/upload (multipart)
}
```

Modelos: `PaymentStatus { paid, activePayment, price }`, `Price { amount, durationDays, currency }`, `Payment { ... }`.

### 6.2 Pantalla nueva `tukytuk/lib/pages/payment_driver_page.dart`

Una sola pantalla con dos secciones:

- **Arriba (estado):** "Al día hasta DD/MM/AAAA" en verde si paid, o "Mensualidad vencida — Q200 por 30 días" en rojo. Botón grande "Subir comprobante de pago".
- **Abajo (historial):** lista scrollable con cada `Payment` mostrando fecha, monto, estado (chip), comentario del admin si fue rechazado, miniatura del comprobante.

Flujo de subir:

- `image_picker.pickImage(source: gallery | camera)` (agregar `image_picker` a `pubspec.yaml`).
- Preview de la imagen.
- Botón "Enviar". Llama `paymentService.uploadReceipt(file)`.
- Loading + manejo de errores (tamaño, tipo, red).
- En éxito: `SnackBar` "Comprobante enviado, esperando aprobación", refresca la lista.

### 6.3 Gate al ponerse en línea

Archivo: donde el conductor toggleé `online` (confirmar en implementación; probablemente `home_driver_page.dart`).

- Antes del PUT: `paymentService.getStatus()`.
- Si `!paid`: `AlertDialog` bloqueante (`barrierDismissible: false`):
  - Título: "Mensualidad vencida".
  - Cuerpo: "Para recibir viajes, sube tu comprobante de pago. Monto: Q200 por 30 días" (toma `price` del status).
  - Botón primario: "Subir comprobante" → navega a `payment_driver`.
  - Botón secundario: "Más tarde" → cierra y deja `online: false`.
- Si `paid`: continúa con el PUT normal.

Fallback de seguridad: si el cliente no llamó `getStatus`, el backend devuelve 402 con el mismo payload y la app muestra el mismo modal.

### 6.4 Listener de sockets

En `SocketService`:

- `payment-approved` → `SnackBar` verde "Tu pago fue aprobado" + refresca status.
- `payment-rejected` → `AlertDialog` "Tu pago fue rechazado" con el `adminComment` visible + botón "Subir otro comprobante".

### 6.5 Rutas

`tukytuk/lib/routes/routes.dart`: agregar `'payment_driver'`.

### 6.6 Dependencias nuevas

- `image_picker` (si no está presente).
- `mime` o equivalente para validar tipo antes de enviar (opcional, el backend ya valida).

## 7. Cambios en el Admin Web

### 7.1 Cliente API

`tukytuk-admin/src/api/payments.ts`:

```ts
export interface Payment { ... }
export interface PaymentSettings { ... }

export const listPayments = (filters) => ...;
export const approvePayment = (id) => ...;
export const rejectPayment = (id, adminComment) => ...;
export const createManualPayment = (data) => ...;
export const getSettings = () => ...;
export const updateSettings = (data) => ...;
export const setSpecialPricing = (driverUid, data) => ...;
```

### 7.2 Páginas nuevas en `tukytuk-admin/src/admin/payments/`

- **`PaymentsListPage.tsx`:** tabla MUI con filtros por status / conductor. Columnas: fecha, conductor (nombre + uid), monto, estado (chip), comprobante (miniatura clickeable que abre modal con la imagen completa), acciones.
  - Pendientes: botones "Aprobar" y "Rechazar".
  - "Rechazar" abre dialog con `adminComment` requerido.
- **`CreateManualPaymentPage.tsx`:** form con `driverUid` (autocomplete de conductores), `adminComment` (textarea, requerido), `amount` y `durationDays` opcionales (placeholders con los defaults), opción de adjuntar comprobante.
- **`PaymentSettingsPage.tsx`:** form con `driverMonthlyPrice`, `driverMonthlyDurationDays`, `currency`. Botón "Guardar".

### 7.3 Detalle del conductor

Si existe `DriverDetailPage` (o se debe crear): agregar sección "Precios especiales" con `specialPrice`, `specialDurationDays` y botón "Quitar precio especial".

### 7.4 Sidebar / navegación

`tukytuk-admin/src/router/AppRouter.jsx` (o equivalente): agregar entrada "Pagos" con sub-rutas:
- `/pagos` → `PaymentsListPage`
- `/pagos/nuevo` → `CreateManualPaymentPage`
- `/pagos/configuracion` → `PaymentSettingsPage`

### 7.5 Componente `<AuthImage>`

Las miniaturas y el modal de tamaño completo cargan la imagen vía `GET /api/payments/receipt/:filename` con el header `x-token`. Como `<img src>` no permite headers custom, creamos un componente reutilizable:

- Fetch la imagen con axios (que ya envía `x-token`).
- Convierte a `Blob`, genera `URL.createObjectURL`.
- Renderiza `<img src={objectUrl}>`. Maneja loading y error.
- Revoca el `objectUrl` al desmontar para evitar fugas de memoria.

## 8. Testing

### 8.1 Backend

- `getDriverPrice`: override del conductor si existe, sino `Settings`.
- `isDriverPaid`: vigencia activa → true; vencida → false; rechazado o pendiente → false aunque exista.
- `getNextStartsAt`: con vigencia activa → fecha de vencimiento del último; sin → `now`.
- `POST /driver/upload`: éxito, rechaza > 5MB, rechaza tipos no permitidos, persiste con `status: 'pendiente'`.
- `PUT /admin/:id/approve`: setea `startsAt`/`expiresAt` correctamente; acumula días si hay vigencia activa; 409 si no estaba `pendiente`; stub de `io.emit` verifica `payment-approved`.
- `PUT /admin/:id/reject`: requiere `adminComment`; stub verifica `payment-rejected`.
- `POST /admin/create`: requiere `adminComment`; permite sin foto; queda `aprobado` directo.
- `PUT /admin/settings`: upsert correcto.
- `GET /receipt/:filename`: 200 para dueño, 200 para admin, 403 para otro conductor, 404 si no existe.
- Gate al ponerse en línea: 402 si conductor sin pago.

### 8.2 Flutter

- Widget test de `PaymentDriverPage`: muestra estado, lista historial, dispara `uploadReceipt` al confirmar.
- Test del modal del gate: aparece cuando `paid: false`, navega a `payment_driver` al tap.
- Test del `PaymentService`: serialización/deserialización contra payloads de ejemplo.

### 8.3 Admin

- Test de `PaymentsListPage`: render con datos, filtro por status, tap en "Rechazar" abre dialog y valida `adminComment` requerido.
- Test de `<AuthImage>`: fetch con auth, muestra imagen, maneja 404.

## 9. Verificación manual (golden path)

Con backend dev, un admin y un conductor de prueba:

1. Admin configura precio base desde `PaymentSettingsPage` → Q200 / 30 días. Persistencia.
2. Conductor sin pago intenta ponerse en línea → modal bloqueante con monto correcto.
3. Conductor sube comprobante (foto desde galería o cámara) → ve "pendiente" en su historial.
4. Admin ve el pago en la lista, abre miniatura del comprobante → se ve la foto.
5. Admin aprueba → conductor recibe `SnackBar` "Pago aprobado" al instante (socket).
6. Conductor se pone en línea → ahora sí queda online.
7. Admin crea pago manual para conductor existente con comentario "pagó en efectivo el 15/06", sin foto → conductor queda al día sin haber subido nada.
8. Conductor sube comprobante, admin rechaza con comentario → conductor ve modal con el comentario.
9. Admin define precio especial para un conductor (Q150 / 60 días) → al pedir `getStatus`, ese conductor ve el monto especial.
10. Acumulación: conductor con vigencia hasta 30/06 sube y se aprueba un pago el 25/06 → nuevo `expiresAt` debe ser 30/07, no 25/07.

## 10. Criterios de aceptación

- [ ] Un conductor sin pago al día no puede ponerse en línea.
- [ ] El conductor puede subir un comprobante desde la app y ver su historial.
- [ ] El admin puede listar pendientes, ver el comprobante, aprobar o rechazar con comentario.
- [ ] El admin puede crear un pago manualmente sin foto (con comentario obligatorio).
- [ ] El precio mensual base y la duración son configurables desde admin.
- [ ] Un conductor puede tener un precio especial (override) que anula el base.
- [ ] Cada `Payment` guarda el monto y los días con los que fue creado (snapshot inmutable).
- [ ] Si el conductor renueva antes de vencer, los días nuevos se acumulan al vencimiento anterior.
- [ ] La aprobación/rechazo notifica al conductor en menos de 1 segundo (socket).
- [ ] Las imágenes de comprobantes no son accesibles públicamente; solo el dueño y los admins.
- [ ] Tests unitarios nuevos pasan en backend, Flutter y admin.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Disco del servidor se llena con comprobantes | Límite 5 MB por archivo + alerta en monitoreo. A futuro, mover a S3 cuando el volumen crezca |
| Pérdida de comprobantes si el EC2 se reemplaza | Backup periódico de `uploads/payments/` (cron + S3 sync, o snapshot EBS) |
| Conductor sube foto irrelevante (no es comprobante real) | El admin la rechaza con comentario. No es un problema técnico |
| Admin aprueba un pago erróneo | Sin "desaprobar" en v1. Si pasa, script de mantenimiento puntual. `reviewedBy` permite auditoría |
| Conductor cambia de mes mientras está online | El gate valida solo al toggle online. Si pasa la medianoche con `online: true`, sigue activo hasta desconectarse. Aceptable en v1 |
| Race condition al aprobar dos pagos casi simultáneos | `getNextStartsAt` puede dar el mismo valor. Improbable porque el admin aprueba uno a la vez en UI. Si pasara, los dos arrancarían igual y el segundo "perdería" días. Tolerable en v1 |

## 12. Despliegue

- **Backend:** deploy a `52.87.214.235`. `npm install multer`. Crear carpeta `uploads/payments/` con permisos del proceso Node. Sin migración de datos.
- **Admin web:** build + deploy del bundle estático.
- **App Flutter:** build nuevo APK. Agregar `image_picker`. Probar permisos de cámara y galería en Android.
- **Orden recomendado:** backend → admin web → app Flutter. Un conductor con app vieja simplemente no ve la opción de subir comprobante; el admin puede cargarle pagos manuales mientras tanto.
- **Comunicación previa:** el admin debe avisar a los conductores existentes que el feature está vivo y que él les cargará el pago manualmente al inicio.
