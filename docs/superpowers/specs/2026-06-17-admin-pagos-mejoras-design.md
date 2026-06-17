# Spec 4 — Mejoras y bugs del admin (pagos, alertas, UID, vencimiento)

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Backend (`tukytukapi/`) + Admin web (`tukytuk-admin/`)

## 1. Objetivo

Atacar tres bugs y dos mejoras estructurales del admin web:

1. **No exponer ObjectIds al admin.** La tabla de pagos muestra el `_id` crudo del conductor en lugar de su nombre; el `SpecialPricingDialog` también pone el uid en el título. Reemplazar por "Nombre — Placa" en todos los puntos.
2. **Alertas consistentes.** Sistema global `useToast()` para que toda acción (crear, editar, guardar, eliminar) muestre feedback uniforme.
3. **Upload de archivos roto en `CreateManualPaymentPage`.** El botón "Adjuntar comprobante" no abre el file picker (patrón `<Button component="label">` falla). Fix puntual + auditoría del resto del admin.
4. **Edición de pago.** Página de detalle del pago donde el admin puede re-subir el comprobante y editar el `adminComment`. Historial de eventos visible.
5. **Vencimiento + desactivación.** Nuevo estado `'vencido'`, endpoint masivo + endpoint individual + botón en `PaymentsListPage` que marca pagos `aprobado` con `expiresAt < now` como vencidos, agrega evento al historial, y desactiva (`Usuario.online = false`) a los conductores afectados.

## 2. Principios

- **Sin exponer IDs internos al usuario humano.** Si el admin necesita identificar un conductor, ve nombre + placa. Los uids siguen viajando en URLs y payloads, pero nunca son lo que se muestra.
- **Append-only para el historial.** Los eventos son inmutables. No se editan ni se borran; solo se agregan.
- **Estado `vencido` separado de `aprobado`.** No reutilizamos `aprobado + expiresAt < now` porque queremos historial limpio y queries simples.
- **Backend dispara eventos automáticamente.** El frontend no maneja eventos manualmente; cada handler del backend agrega el evento correspondiente antes de devolver la respuesta.

## 3. Fuera de alcance

- Cron job automático de vencimiento (follow-up).
- Notificaciones push/email al conductor cuando su pago vence o se aprueba.
- Cerrar el socket del conductor en tiempo real cuando se vence su pago (`emit('payment-expired')`). El gate del próximo toggle online lo bloquea — suficiente para v1.
- KPIs/dashboard.
- Exportar histórico a CSV.
- Soft-delete o restauración de pagos.

## 4. Backend: modelo y endpoints

### 4.1 Cambios al modelo `Payment` (`tukytukapi/models/payment.js`)

```js
status: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado', 'vencido'],   // + 'vencido'
    default: 'pendiente',
    index: true
},
events: {                                                       // nuevo
    type: [{
        type: { type: String, required: true },                 // ej. 'creado', 'aprobado'
        at: { type: Date, required: true, default: () => new Date() },
        by: { type: String },                                    // uid del admin, uid del conductor, o 'system'
        reason: { type: String }                                 // opcional, ej. motivo del rechazo
    }],
    default: []
}
```

**Tipos de evento** (string libre, no enum estricto):
- `creado` — al crear el Payment (por driver o admin).
- `comprobante_actualizado` — cuando se reemplaza el comprobante.
- `aprobado` — handler `adminApprovePayment` lo agrega.
- `rechazado` — handler `adminRejectPayment` lo agrega; `reason` = `adminComment`.
- `vencido` — masivo: `by: 'system'`. Individual: `by: req.uid` (admin manual).
- `comentario_editado` — cuando el admin cambia `adminComment` vía PATCH.

**Migración:** ninguna. Documentos viejos tendrán `events: []`; el frontend muestra "Pago creado" implícito desde `createdAt`.

### 4.2 Endpoints

#### `GET /api/payments/admin/list` (cambio)

Hoy devuelve `Payment[]` con `driver` crudo. Cambio: aggregate con `$lookup` a `Usuario` y `Driver`.

```js
const pipeline = [
    { $match: filter },              // status, driverUid (existentes)
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
    // paginación con $facet (igual que ahora)
];
```

`preserveNullAndEmptyArrays: true` para no perder pagos huérfanos.

#### `GET /api/payments/admin/:id` (nuevo)

Detalle de un pago con nombre/placa del conductor + historial.

- **Auth:** `validarAdmin`.
- **Lógica:** mismo lookup que en list, filtrado por `_id`. 404 si no existe.
- **Respuesta:** `{ ok, payment, driverNombre, driverApellido, driverPlate }`.

#### `PATCH /api/payments/admin/:id` (nuevo)

Edición de comentario o reemplazo de comprobante.

- **Auth:** `validarAdmin`.
- **Body:** `multipart/form-data` con campos opcionales:
  - `adminComment` (texto). Si viene y difiere del actual: actualiza + agrega evento `comentario_editado` con `reason: <nuevo>`.
  - `imagen` (archivo). Si viene: valida con `helpers/upload.js` (jpeg/png/webp, 5MB), guarda en `uploads/payments/`, **borra el archivo anterior** (best-effort `fs.unlink`), actualiza `receiptUrl`, agrega evento `comprobante_actualizado`.
- **Validación de estado:** rechaza con 409 si `status === 'aprobado' || status === 'vencido'`. Solo edita `pendiente` o `rechazado`.
- **Respuesta:** `{ ok, payment }`.
- **Reglas de evento:** todos los eventos agregados llevan `by: req.uid`.

#### `POST /api/payments/admin/expire-overdue` (nuevo masivo)

- **Auth:** `validarAdmin`.
- **Lógica:**
  1. `Payment.find({ status: 'aprobado', expiresAt: { $lt: new Date() } })`.
  2. Por cada uno: `status = 'vencido'`, `events.push({ type: 'vencido', at: now, by: 'system' })`, save.
  3. Para cada `driver` único: `Usuario.updateOne({ _id: driver, type: 'C' }, { $set: { online: false } })`.
- **Respuesta:** `{ ok, expiredCount, deactivatedDrivers }`.
- **Idempotencia:** dos corridas seguidas no causan daño.

#### `POST /api/payments/admin/:id/expire` (nuevo individual)

- **Auth:** `validarAdmin`.
- **Lógica:**
  1. Carga el pago. 404 si no existe.
  2. 409 si `status !== 'aprobado'` (solo aprobados se pueden vencer).
  3. `status = 'vencido'`, `events.push({ type: 'vencido', at: now, by: req.uid })`, save.
  4. `Usuario.updateOne({ _id: payment.driver, type: 'C' }, { $set: { online: false } })`.
- **Respuesta:** `{ ok, payment }`.

### 4.3 Cambios en endpoints existentes (agregar eventos)

| Handler | Evento agregado | `by` |
|---|---|---|
| `uploadDriverPayment` | `creado` | `req.uid` (uid del conductor que sube) |
| `adminCreatePayment` | `creado` | `req.uid` (uid del admin) |
| `adminApprovePayment` | `aprobado` | `req.uid` |
| `adminRejectPayment` | `rechazado` (`reason = adminComment`) | `req.uid` |

### 4.4 Resumen tabular

| Método | Ruta | Auth | Side-effects |
|---|---|---|---|
| `GET` | `/api/payments/admin/list` | Admin | Lookup (sin cambios de datos) |
| `GET` | `/api/payments/admin/:id` | Admin | — |
| `PATCH` | `/api/payments/admin/:id` | Admin | Edita comentario, reemplaza receipt, agrega eventos |
| `POST` | `/api/payments/admin/:id/expire` | Admin | Marca vencido un pago + desactiva conductor |
| `POST` | `/api/payments/admin/expire-overdue` | Admin | Marca vencidos los expirados + desactiva conductores |

## 5. Frontend: ToastProvider, fix de upload, mostrar nombre

### 5.1 Sistema global de alertas

**Archivos nuevos:**
- `tukytuk-admin/src/components/toast/ToastProvider.tsx`
- `tukytuk-admin/src/components/toast/useToast.ts`

**Interfaz:**

```ts
export interface Toast {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

export function useToast(): Toast;
```

**Implementación:**
- `ToastProvider` mantiene una cola FIFO de toasts en state. Expone `push(kind, text)` por React Context.
- Renderiza un único `<Snackbar>` MUI anclado en `{vertical: 'bottom', horizontal: 'center'}`, autohide 3 s.
- Si llegan varios toasts seguidos se encolan y se muestran uno a uno (no se solapan).
- `useToast()` lee el contexto y devuelve `{ success, error, info }`. Si se llama fuera del provider, lanza error en dev.

**Integración:** envolver `<AdminLayout>` con `<ToastProvider>` en `JournalRoutes.jsx`.

**Pantallas a migrar** (eliminar Snackbar local + state `snack`/`msg`, reemplazar por `useToast()`):
- `src/admin/drivers/DriverDetailPage.tsx`
- `src/admin/drivers/DriversListPage.tsx` (toasts para approve/reject; el Alert de error de carga se mantiene como estado de pantalla)
- `src/components/DriverImagePicker.tsx`
- `src/admin/payments/SpecialPricingPage.tsx`
- `src/admin/payments/PaymentsListPage.tsx`
- `src/admin/payments/CreateManualPaymentPage.tsx`
- `src/admin/payments/PaymentSettingsPage.tsx`
- `src/admin/payments/SpecialPricingDialog.tsx`

`AuthImage.tsx` no usa Snackbar (sigue con Alert inline). Sin cambio.

### 5.2 Fix del upload de archivos roto

**Bug en** `src/admin/payments/CreateManualPaymentPage.tsx:95-103`: el patrón

```tsx
<Button variant="outlined" component="label">
  Adjuntar comprobante
  <input type="file" hidden ... />
</Button>
```

no abre el file picker en la versión actual de MUI.

**Fix:** replicar el patrón del `DriverImagePicker` con `inputRef.current?.click()`:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
const onPick = () => inputRef.current?.click();
// ...
<Button variant="outlined" onClick={onPick} disabled={busy}>
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

`e.target.value = ''` permite re-elegir el mismo archivo.

**Auditoría del resto del admin:** `grep -rn '<input type="file"' src/` confirma que solo aparecen en `CreateManualPaymentPage` (broken) y `DriverImagePicker` (OK). El nuevo `PaymentDetailPage` (sección 6) usa el patrón correcto desde su nacimiento.

### 5.3 Mostrar nombre en lugar de UID

#### `PaymentsListPage.tsx`
- Columna "Conductor" muestra `${driverNombre} ${driverApellido ?? ''} — ${driverPlate ?? 's/placa'}` con los campos nuevos del endpoint.
- Si campos vacíos (pago huérfano): muestra "—".

#### `SpecialPricingDialog.tsx`
- Nuevo prop opcional `driverLabel?: string`.
- Title cambia a `"Precio especial — ${driverLabel ?? 'conductor'}"`.
- Llamadores (`DriverDetailPage`, `SpecialPricingPage`) pasan `driverLabel` con el nombre+placa que tienen a mano.

#### `DriverAutocomplete.tsx`
- Ya tiene el lookup interno (fix del Spec 3 final review). Verificar que dispara cuando `value` llega del query param sin `initialLabel`.

#### `SpecialPricingPage.tsx`
- Limpiar referencias a "uid" en placeholder/helperText si quedan.

#### `DriverDetailPage.tsx`
- Verificar que el breadcrumb no caiga al uid si nombre está vacío. Usar fallback "Conductor" si todo viene null.

**Búsqueda final:** `grep -rn "driverUid\|\.driver\b" src/admin --include="*.tsx" | grep -v "// internal" | grep -v "navigate\|URLSearchParams"` debe arrojar cero lugares donde el uid se muestre al usuario.

## 6. Frontend: PaymentDetailPage + botón vencidos

### 6.1 `PaymentDetailPage` (nueva)

**Archivo:** `tukytuk-admin/src/admin/payments/PaymentDetailPage.tsx`.
**Ruta:** `/admin/pagos/:id` en `JournalRoutes.jsx`.

**Layout** (esquemático):

```
←  Inicio  ›  Pagos  ›  Pago de Juan Pérez

Pago de Juan Pérez — P-123ABC                  [Marcar como vencido si aprobado]

╭─ Datos ────────────────────────────────────────╮
│  Conductor:   Juan Pérez — P-123ABC            │
│  Monto:       Q200 por 30 días                 │
│  Estado:      [chip]                           │
│  Creado por:  driver | admin                   │
│  Subido:      14/06/2026 13:42                 │
│  Vigencia:    — (o "hasta DD/MM/AAAA")         │
│                                                │
│  Comentario admin:  [textarea]                 │
│                                                │
│  Comprobante:                                  │
│  <AuthImage receiptUrl="..." />                │
│  [Reemplazar comprobante]                      │
│                                                │
│                              [Cancelar] [Guardar] │
╰────────────────────────────────────────────────╯

╭─ Historial ────────────────────────────────────╮
│  ● 14/06 13:42  Pago creado (driver)           │
│  ● 14/06 13:50  Comprobante actualizado        │
│  ● 14/06 14:05  Rechazado: "foto borrosa"      │
╰────────────────────────────────────────────────╯
```

**Comportamiento:**

- Load: `GET /api/payments/admin/:id` → `{ payment, driverNombre, driverApellido, driverPlate }`.
- Form local `{ adminComment?, receipt? }` con diff parcial.
- "Reemplazar comprobante" usa el patrón `inputRef.click()` corregido en 5.2.
- "Guardar" arma `FormData` con los campos cambiados y hace `PATCH /api/payments/admin/:id`.
  - Éxito → `toast.success('Pago actualizado')`, refresca.
  - Error → `toast.error(<msg del servidor>)`.
- **Form deshabilitado** cuando `status === 'aprobado' || 'vencido'` con Alert info: "Este pago ya está cerrado; no se puede editar."
- **Acciones rápidas en el header:**
  - Si `pendiente`: botones "Aprobar" / "Rechazar" (reusa el flujo de la lista).
  - Si `aprobado`: botón outlined "Marcar como vencido" (warning color) → dialog de confirmación → `POST /api/payments/admin/:id/expire`.

**Historial:**

Componente local `<EventTimeline events={payment.events} createdAt={payment.createdAt} />`:
- Si `events` está vacío, muestra solo "Pago creado" implícito desde `createdAt`.
- Cada evento renderiza: punto colorado por tipo (verde aprobado, rojo rechazado, gris vencido/comentario, azul comprobante), fecha relativa + absoluta, autor (`admin` / `system` / `driver`), `reason` si existe.

### 6.2 Botón "Marcar vencidos" (masivo)

**Ubicación:** header de `PaymentsListPage.tsx`, junto a "Nuevo pago" / "Configuración" / "Precio especial".

**UX:**
- Botón outlined "Marcar vencidos" con icono de reloj.
- Click → `AlertDialog`:
  - Título: "Marcar pagos vencidos"
  - Cuerpo: "Esto marcará como vencidos todos los pagos aprobados cuya vigencia haya expirado y desactivará a los conductores afectados. ¿Continuar?"
  - Acciones: "Cancelar" / "Marcar vencidos" (color warning).
- Confirmación → `POST /api/payments/admin/expire-overdue`.
- Éxito → `toast.success('Vencidos: X pagos, Y conductores desactivados')` con los conteos del response. Refresca la lista.
- Error → `toast.error(...)`.
- Mientras está en vuelo: botón disabled + CircularProgress.
- Si `expiredCount === 0`: `toast.info('No hay pagos para vencer')`.

### 6.3 Filtro y navegación

**`PaymentsListPage.tsx`:**
- Agregar `"Vencido"` al `<TextField select label="Estado">`.
- Nueva columna "Acciones" gana un botón "Ver" que navega a `/admin/pagos/:id`.

### 6.4 Cliente API admin (`src/api/payments.ts`)

```ts
export interface PaymentEvent {
  type: string;
  at: string;
  by?: string;        // 'system' | uid
  reason?: string;
}

export interface PaymentDetail {
  payment: Payment & { events: PaymentEvent[] };
  driverNombre?: string;
  driverApellido?: string;
  driverPlate?: string;
}

// El componente de UI determina el autor del evento por convención:
// - 'system' → "Sistema"
// - igual al usuario logueado → "Yo"
// - cualquier otro uid → "Admin" o "Conductor" según contexto
// (no se traduce a nombre humano para evitar otro lookup en el render)

export async function getPayment(id: string): Promise<PaymentDetail>;
export async function patchPayment(id: string, form: FormData): Promise<Payment>;
export async function expirePayment(id: string): Promise<Payment>;
export async function expireOverduePayments(): Promise<{ expiredCount: number; deactivatedDrivers: number }>;
```

Extender la interfaz `Payment` con `events?: PaymentEvent[]`.

Tipar con genéricos `apiClient.get<T>` / `patch<T>` / `post<T>`.

Extender `Payment.status` literal a `'pendiente' | 'aprobado' | 'rechazado' | 'vencido'`.

## 7. Testing

### 7.1 Backend (`tukytukapi/`)

- `tests/payments-list-lookup.test.js`: aggregate de `adminListPayments` agrega `$lookup` y devuelve `driverNombre`/`driverPlate`. Pago huérfano (sin driver row) sigue apareciendo gracias a `preserveNullAndEmptyArrays`.
- `tests/payments-detail.test.js`: `GET /admin/:id` 200 con shape esperado, 404 si no existe.
- `tests/payments-patch.test.js`:
  - Edita `adminComment` y agrega evento `comentario_editado`.
  - Reemplaza `receiptUrl`, mock `fs.unlink` se llama con la ruta del archivo viejo, agrega evento `comprobante_actualizado`.
  - 409 si `status === 'aprobado' || 'vencido'`.
  - 404 si no existe.
- `tests/payments-expire-overdue.test.js`:
  - Actualiza N pagos a `'vencido'`, agrega evento con `by: 'system'`, desactiva conductores únicos.
  - Idempotencia: segunda corrida devuelve `expiredCount: 0`.
- `tests/payments-expire-individual.test.js`:
  - 200 con `by: req.uid` cuando es aprobado.
  - 409 si no es `'aprobado'`.
  - 404 si no existe.
- `tests/payments-events.test.js`: cada handler existente (`uploadDriverPayment`, `adminCreatePayment`, `adminApprovePayment`, `adminRejectPayment`) agrega el evento correcto.

### 7.2 Admin (`tukytuk-admin/`)

Sin framework de tests; disciplina:
- `npm run lint --max-warnings 0`.
- `npm run build` exitoso.

## 8. Verificación manual (golden path)

1. **Toast global:** crear/editar/guardar en distintas pantallas. Todos los mensajes vienen del mismo Snackbar en la esquina inferior. Consistentes en español.
2. **Sin UID visible:** `/admin/pagos` — columna "Conductor" muestra "Nombre — Placa". Dialog de precio especial: title con nombre, no uid.
3. **Upload arreglado:** `/admin/pagos/nuevo` — click "Adjuntar comprobante" abre file picker. Subir un PNG. Crear pago.
4. **Detalle del pago:** click "Ver" en una fila → `/admin/pagos/:id`. Ver datos, comprobante, histórico cronológico.
5. **Editar pago pendiente:** cambiar comentario, guardar → toast verde, evento `comentario_editado` en historial. Reemplazar comprobante → nuevo archivo en disco, viejo eliminado, evento `comprobante_actualizado`. Aprobar/rechazar normalmente.
6. **Pago aprobado bloqueado:** abrir un pago aprobado → form deshabilitado con Alert info. Backend rechaza PATCH con 409 si se intenta forzar.
7. **Vencimiento individual:** abrir un pago aprobado con `expiresAt < now` → botón "Marcar como vencido" → confirmar → status `'vencido'`, evento con `by: <admin-uid>`, conductor `online: false`.
8. **Vencimiento masivo:** desde la lista, "Marcar vencidos" → confirmar → toast "Vencidos: X pagos, Y conductores desactivados". Verificar en MongoDB que los aprobados expirados ahora son `'vencido'`.
9. **Filtro vencidos:** select estado → "Vencido" → solo los vencidos.
10. **Gate Spec 2:** conductor con pago recién vencido intenta ponerse online en la app → modal "Mensualidad vencida".

## 9. Criterios de aceptación

- [ ] Ningún UID/ObjectId visible al admin en ninguna pantalla.
- [ ] Toda acción CRUD muestra toast vía `useToast()`.
- [ ] El botón "Adjuntar comprobante" de `CreateManualPaymentPage` abre el file picker.
- [ ] `/admin/pagos/:id` muestra datos, comprobante, historial completo.
- [ ] PATCH permite editar comentario y reemplazar comprobante en `pendiente`/`rechazado`; 409 en `aprobado`/`vencido`.
- [ ] `expire-overdue` masivo: pagos vencidos en historial con `by: 'system'`; conductores `Usuario.online = false`.
- [ ] `:id/expire` individual: pago vencido con `by: <admin-uid>`; conductor desactivado.
- [ ] Filtro "Vencido" en la lista funciona.
- [ ] Tests backend nuevos pasan + suite completa OK.
- [ ] `npm run lint --max-warnings 0` y `npm run build` del admin pasan.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pagos viejos sin `events` | Frontend muestra "Pago creado" implícito desde `createdAt`. Cero migración |
| Borrar archivo viejo falla (permisos) | `fs.unlink` best-effort dentro de try/catch. El nuevo archivo se guarda igual; el viejo queda huérfano (limpieza manual al deploy) |
| Lookup en `listPayments` ralentiza con muchos pagos | Índices ya existen (`Payment.driver`, `Driver.usuario`, `Usuario._id`). Performance aceptable hasta miles de pagos |
| "Marcar vencidos" durante alta concurrencia | Idempotente; corridas múltiples no causan daño |
| Conductor con sesión activa cuando se vence su pago | `Usuario.online = false` no cierra socket ni invalida JWT. Gate aplica al próximo toggle. Follow-up: emit `payment-expired` socket |
| Shape de `listPayments` rompe consumidores viejos | Solo el admin consume este endpoint; campos nuevos son aditivos. Sin breaking changes |

## 11. Despliegue

- **Backend:** deploy a `52.87.214.235`. Sin migración de datos (campos aditivos en `Payment.events`, enum `'vencido'` aditivo).
- **Admin:** `npm run build` + deploy.
- **App Flutter:** sin cambios.
- **Orden:** backend primero (los endpoints nuevos no rompen consumidores viejos), luego admin.
