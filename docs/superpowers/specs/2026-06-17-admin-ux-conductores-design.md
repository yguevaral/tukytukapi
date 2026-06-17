# Spec 3 — UX del admin para conductores

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Backend (`tukytukapi/`) + Admin web (`tukytuk-admin/`)

## 1. Objetivo

Mejorar la experiencia del administrador en el portal web:

1. Convertir el módulo de conductores en un CRUD navegable con búsqueda, paginación y edición completa.
2. Reemplazar los campos de texto crudo `driverUid` por un autocomplete reusable en todas las pantallas donde aparece.
3. Agregar navegación contextual (breadcrumbs con flecha de regreso) en todas las páginas no-raíz.

### Problemas que resuelve

- Hoy hay 3 pantallas que piden `driverUid` como texto crudo (filtro de `PaymentsListPage`, form de `CreateManualPaymentPage`, form de `SpecialPricingPage`). El admin tiene que copiar/pegar UIDs largos. Errores frecuentes.
- No existe un directorio de conductores. Solo hay `PendingDriversPage` (solo pendientes) y `CreateDriverPage` (solo crear). No se puede ver/editar conductores ya aprobados desde la web.
- No hay forma de editar datos de un conductor existente desde la web. Cualquier corrección requiere acceso a la base de datos.
- Falta navegación contextual: el admin se pierde en jerarquías de 3 niveles sin breadcrumbs.

## 2. Principios

- **Reutilización:** un solo endpoint backend de listado/búsqueda alimenta el directorio Y el autocomplete. Un solo componente `<DriverAutocomplete>` reemplaza los 3 campos crudos. Un solo `<PageBreadcrumbs>` en todas las páginas no-raíz.
- **Filtros en vez de pantallas separadas:** el listado de conductores usa chips por status; `PendingDriversPage` se absorbe como un filtro `?status=P` y se elimina.
- **Pagos del conductor sin duplicar UI:** el botón "Ir a pagos" navega a `/admin/pagos?driverUid=<uid>`. `PaymentsListPage` lee el query param e inicializa el filtro.
- **Edición segura:** email editable con dialog de confirmación; status editable con enum guard; imágenes con upload real (multer); password e imágenes se cambian solo desde aquí, no automáticamente.
- **Backend mínimo:** cinco endpoints nuevos (listar, detalle, update, subir imagen, servir imagen). Todo lo demás se mantiene.

## 3. Fuera de alcance

- Cambio de password del conductor.
- Dashboard / KPIs / ratings.
- Reset masivo de estados.
- Migración del storage de imágenes a S3 / Cloudinary.
- Soft-delete o auditoría de cambios (quién editó qué).
- Internacionalización (la app es Spanish-only por ahora).

## 4. Endpoints backend

### 4.1 Nuevos

#### `GET /api/usuarios/admin/drivers`

Lista paginada con búsqueda y filtro de status. Mismo endpoint sirve para el autocomplete.

- **Auth:** JWT + `validarAdmin`.
- **Query params:**
  - `status?`: `'A'`, `'R'`, `'P'`. Si se omite, no filtra por status.
  - `search?`: string (≥ 1 carácter). Si se omite, no filtra por texto.
  - `page?`: int ≥ 1. Default 1.
  - `limit?`: int 1..100. Default 20.
- **Lógica:**
  - Construir aggregate sobre `Driver`:
    1. `$lookup` a `Usuario` por `usuario` (foreign key).
    2. `$unwind` el usuario.
    3. Si `status`: `$match { 'driver.status': status }`.
    4. Si `search`: `$match { $or: [...] }` con regex case-insensitive sobre `usuario.nombre`, `usuario.apellido`, `usuario.email`, `driver.plate`.
    5. `$facet` para obtener `drivers` paginados y `total` en una sola query.
- **Respuesta:** `{ ok: true, drivers: [{ driver, usuario }], total, page, limit }`.

#### `GET /api/usuarios/admin/drivers/:uid`

Detalle de un conductor.

- **Auth:** JWT + `validarAdmin`.
- **Lógica:** `Usuario.findById(uid)`. Si no existe o `type !== 'C'` → 404. Carga `Driver.findOne({ usuario: uid })`.
- **Respuesta:** `{ ok: true, usuario, driver }`. `driver` puede ser `null` si el conductor no completó onboarding.

#### `PUT /api/usuarios/admin/drivers/:uid`

Editar datos del conductor.

- **Auth:** JWT + `validarAdmin`.
- **Body** (todos opcionales — diff parcial):
  - **Usuario:** `nombre`, `apellido`, `email`, `telefono`.
  - **Driver:** `plate`, `locallicense`, `address`, `status`, `commentsAdmin`.
- **Validación express-validator en la ruta:**
  - `email().optional().isEmail()`.
  - `status().optional().isIn(['A','R','P'])`.
  - El resto: validación de longitud mínima sólo si vienen.
- **Lógica:**
  - 404 si el `uid` no existe o `type !== 'C'`.
  - Si `email` viene y es distinto del actual: `Usuario.findOne({ email })`. Si encuentra otro distinto a `uid` → 409 `{ ok: false, msg: 'email_duplicado' }`.
  - Actualiza `Usuario` y `Driver` por separado (sin transacción; el costo de fallar a mitad es bajo y reportable).
- **Respuesta:** `{ ok: true, usuario, driver }`.

#### `POST /api/usuarios/admin/drivers/:uid/imagen`

Subir/reemplazar imagen.

- **Auth:** JWT + `validarAdmin`.
- **Body:** `multipart/form-data` con campo `imagen` (file) + campo `tipo` ∈ `'perfil'`, `'dpi1'`, `'dpi2'`.
- **Lógica:**
  - Multer configurado con `helpers/upload-drivers.js` (nuevo): destino `uploads/drivers/`, 5 MB max, mimetypes `image/jpeg|png|webp`.
  - Validar `tipo`. Si inválido → 400.
  - Mapear `tipo` → campo de `Driver`: `'perfil'`→`imageProfile`, `'dpi1'`→`imageDPI1`, `'dpi2'`→`imageDPI2`.
  - Actualizar el campo a `/api/usuarios/admin/drivers/imagen/<filename>`.
- **Respuesta:** `{ ok: true, driver }`.

#### `GET /api/usuarios/admin/drivers/imagen/:filename`

Servir imagen con auth.

- **Auth:** JWT.
- **Lógica:**
  - Validar `filename` regex `/^[a-zA-Z0-9._-]+$/`. Si no → 400.
  - Buscar el `Driver` cuyo campo (`imageProfile`, `imageDPI1` o `imageDPI2`) contiene el `filename`.
  - Si no se encuentra → 404.
  - Autorizar: el `Usuario` cuyo `_id === driver.usuario` (el conductor dueño) **o** un admin. Si no → 403.
  - Resolver path absoluto, validar que esté dentro de `uploads/drivers/`. `sendFile`.

### 4.2 Sin cambios en endpoints existentes

`GET /usuarios/driver/adminListDriverPending` queda en el backend por compatibilidad pero el admin ya no lo llama. Marcarlo como "deprecated" en un comentario para limpieza futura.

### 4.3 Resumen tabular

| Método | Ruta | Auth | Body / Query | Side-effects |
|---|---|---|---|---|
| `GET` | `/api/usuarios/admin/drivers` | Admin | `?status&search&page&limit` | — |
| `GET` | `/api/usuarios/admin/drivers/:uid` | Admin | — | — |
| `PUT` | `/api/usuarios/admin/drivers/:uid` | Admin | campos opcionales | actualiza Usuario y/o Driver |
| `POST` | `/api/usuarios/admin/drivers/:uid/imagen` | Admin | multipart `imagen` + `tipo` | guarda archivo, actualiza Driver |
| `GET` | `/api/usuarios/admin/drivers/imagen/:filename` | JWT | — | sirve binario |

### 4.4 Índices Mongoose nuevos

```js
// models/usuario.js — email ya tiene unique index
// models/driver.js — agregar:
DriverSchema.index({ plate: 1 });
DriverSchema.index({ status: 1, usuario: 1 });
```

## 5. Componentes admin compartidos

### 5.1 `<DriverAutocomplete>`

**Archivo:** `tukytuk-admin/src/components/DriverAutocomplete.tsx`.

**API:**

```tsx
interface DriverAutocompleteProps {
  value: string | null;                          // uid seleccionado
  onChange: (uid: string | null, label: string) => void;
  label?: string;                                 // default "Conductor"
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  initialLabel?: string;                          // para pre-llenar cuando llegas con uid en URL
}
```

**Comportamiento:**
- MUI `Autocomplete` con `freeSolo={false}`, `loading={true}` mientras hace fetch.
- Debounce 300 ms sobre el input. Cancela la request previa con AbortController.
- Cada opción renderiza: `"Juan Pérez — P-123ABC — jperez@email.com"`.
- Mínimo 1 carácter para disparar la búsqueda. Si está vacío, muestra placeholder.
- Errores: si la llamada falla, MUI `Alert` discreto dentro del dropdown.
- Internamente llama a `GET /usuarios/admin/drivers?search=<q>&limit=10`.

### 5.2 `<PageBreadcrumbs>`

**Archivo:** `tukytuk-admin/src/components/PageBreadcrumbs.tsx`.

**API:**

```tsx
interface BreadcrumbItem {
  label: string;
  to?: string;          // si está, es link; si no, es texto plano (último item)
}

interface PageBreadcrumbsProps {
  items: BreadcrumbItem[];
  backTo?: string;       // ruta del botón ←; default: items[items.length - 2]?.to
}
```

**Render:**
```
←  Conductores  ›  Juan Pérez  ›  Pagos
```

- Flecha (`IconButton` con `ArrowBackIcon`) navega a `backTo`. Si no se pasa, deduce del penúltimo item.
- Items con `to` son `<Link component={RouterLink}>`. El último (sin `to`) es texto plano.
- Si `items.length <= 1`, no renderiza nada (la página raíz no necesita breadcrumb).

### 5.3 `<DriverImagePicker>`

**Archivo:** `tukytuk-admin/src/components/DriverImagePicker.tsx`.

**API:**

```tsx
interface DriverImagePickerProps {
  driverUid: string;
  tipo: 'perfil' | 'dpi1' | 'dpi2';
  currentUrl?: string;          // p.ej. "/api/usuarios/admin/drivers/imagen/abc.jpg"
  label: string;                 // "Foto de perfil", "DPI frontal", "DPI posterior"
  onUploaded: (newUrl: string) => void;
}
```

**Comportamiento:**
- Si `currentUrl`: usa `<AuthImage receiptUrl={currentUrl} style={{ width: 180, height: 240 }} />` (componente del Spec 2 — el nombre del prop es histórico, sirve para cualquier URL servida con auth).
- Si no hay imagen: placeholder con icono y el `label`.
- Botón "Reemplazar" → `<input type="file" hidden accept="image/jpeg,image/png,image/webp">`. En `onChange` hace POST multipart a `/usuarios/admin/drivers/:uid/imagen` con `{ imagen, tipo }`.
- Mientras está en vuelo: `CircularProgress` + botón disabled.
- En éxito: SnackBar de confirmación + `onUploaded(newUrl)`.

### 5.4 Por qué tres componentes y no uno grande

Cada componente tiene una responsabilidad clara: seleccionar conductor, mostrar contexto de navegación, gestionar imagen. Se prueban y mantienen independientes. El detalle del conductor los compone sin acoplarlos.

## 6. Pantallas y routing

### 6.1 Rutas

| Ruta | Componente | Estado |
|---|---|---|
| `/admin/drivers` | `DriversListPage` | Nueva |
| `/admin/drivers/new` | `CreateDriverPage` | Existente, agrega Breadcrumb |
| `/admin/drivers/:uid` | `DriverDetailPage` | Nueva |
| `/admin/drivers/pending` | redirect a `/admin/drivers?status=P` | Compatibilidad de bookmarks |
| `/admin/pagos*` | (existentes) | Sin cambio funcional; gana lectura de `?driverUid` |

### 6.2 `DriversListPage` (nueva)

**Archivo:** `tukytuk-admin/src/admin/drivers/DriversListPage.tsx`.

**Estado:**
```ts
filters: {
  status?: 'A' | 'R' | 'P',   // default 'A'
  search?: string,
  page: number,                // default 1
  limit: number,               // 20
}
```

**Layout (esquemático):**

```
←  Inicio  ›  Conductores

Conductores                                    [+ Nuevo conductor]

[Todos] [Aprobados] [Pendientes] [Rechazados]   buscar: [____________]

| Estado | Nombre completo | Email      | Placa     | Acciones                |
|--------|-----------------|------------|-----------|-------------------------|
| ✓ A    | Juan Pérez      | jperez@…   | P-123ABC  | [Editar] [Ir a pagos]   |
| ⏳ P    | María R.        | maria@…    | P-456DEF  | [Editar] [Aprobar] [Rechazar] [Ir a pagos] |

Total: 87                                       ◄ 1 2 3 … ►
```

**Acciones por fila:**
- "Editar" → `navigate('/admin/drivers/' + uid)`.
- "Ir a pagos" → `navigate('/admin/pagos?driverUid=' + uid)`.
- Para `status='P'`: "Aprobar" / "Rechazar" inline (reusa `setDriverStatus` ya existente, mismo pattern de `PendingDriversPage`).

**Carga:**
- `useCallback` para `load` con dep `[filters]`. `useEffect(load)`.
- Debounce 300 ms sobre `search` para no disparar request por cada tecla.

### 6.3 `DriverDetailPage` (nueva)

**Archivo:** `tukytuk-admin/src/admin/drivers/DriverDetailPage.tsx`.

**Ruta:** `/admin/drivers/:uid`. Lee `:uid` con `useParams`.

**Layout:**

```
←  Inicio  ›  Conductores  ›  Juan Pérez

Juan Pérez                                      [Ir a pagos]

╭─ Datos ────────────────────────────────────────╮
│  Nombre*       [Juan            ]              │
│  Apellido      [Pérez           ]              │
│  Email*        [jperez@…        ]              │
│  Teléfono      [+502 5555…      ]              │
│  Placa*        [P-123ABC        ]              │
│  Licencia*     [12345           ]              │
│  Dirección*    [Zona 10…        ]              │
│  Status        [Aprobado ▼     ]               │
│  Comentarios   [______________]                │
│                                                │
│                              [Cancelar] [Guardar] │
╰────────────────────────────────────────────────╯

╭─ Precio especial ──────────────────────────────╮
│  Actual: Q150 / 60 días (o "Usa precio base")  │
│  [Editar precio especial] → abre SpecialPricingDialog │
╰────────────────────────────────────────────────╯

╭─ Imágenes ─────────────────────────────────────╮
│  [Perfil]   [DPI frontal]   [DPI posterior]    │
│  <DriverImagePicker x3>                        │
╰────────────────────────────────────────────────╯
```

**Comportamiento:**
- Mount: `GET /usuarios/admin/drivers/:uid` → carga `{usuario, driver}`.
- "Guardar" envía PUT con solo los campos cambiados (diff). En éxito: SnackBar + re-fetch.
- **Email modificado:** MUI `Dialog` "¿Cambiar el email de login a X? El conductor deberá usar el nuevo email para iniciar sesión." con `disableEscapeKeyDown` y `onClose` que ignora clicks fuera; botones "Cancelar" / "Confirmar y guardar".
- Si el backend devuelve 409 `email_duplicado`: error inline en el campo email.
- "Ir a pagos" del header: `navigate('/admin/pagos?driverUid=' + uid)`.
- Tres `<DriverImagePicker>` (perfil, DPI1, DPI2) con su `currentUrl` y `onUploaded` que actualiza el state local.
- "Editar precio especial" reusa `<SpecialPricingDialog>` existente del Spec 2 con `driverUid` ya seteado.

### 6.4 Cambios en pantallas existentes

#### `PaymentsListPage.tsx`
- Reemplazar TextField de `driverUid` por `<DriverAutocomplete>`.
- Leer query param `driverUid` con `useSearchParams` en mount → inicializar `filters.driverUid`.
- Agregar `<PageBreadcrumbs items={[{label:'Inicio', to:'/'}, {label:'Pagos'}]} />`.

#### `CreateManualPaymentPage.tsx`
- Reemplazar TextField de `driverUid` por `<DriverAutocomplete>`.
- Agregar Breadcrumb: `Inicio › Pagos › Nuevo pago`.

#### `PaymentSettingsPage.tsx`
- Agregar Breadcrumb: `Inicio › Pagos › Configuración`.

#### `SpecialPricingPage.tsx`
- Reemplazar TextField de `driverUid` por `<DriverAutocomplete>`.
- Agregar Breadcrumb: `Inicio › Pagos › Precio especial`.
- Se mantiene esta página como punto de entrada rápido al dialog, aunque el detalle del conductor ahora también lo expone.

#### `CreateDriverPage.tsx`
- Sin cambios funcionales. Agregar Breadcrumb: `Inicio › Conductores › Nuevo`.

#### `PendingDriversPage.tsx`
- **Eliminar el archivo.** Su funcionalidad se incorpora a `DriversListPage` con filtro `status='P'`.

#### `AdminSidebar.tsx`
- `NAV_ITEMS` actualizado:
  - Quitar: "Conductores pendientes", "Crear conductor".
  - Agregar: **"Conductores"** → `/admin/drivers` (icono `PeopleIcon` o `DirectionsCarIcon`).
- Resultado final: `Inicio` | `Conductores` | `OTPs pendientes` | `Pagos`.

#### `JournalRoutes.jsx`
- Agregar nuevas rutas y el redirect:
  ```jsx
  <Route path="/admin/drivers" element={<DriversListPage />} />
  <Route path="/admin/drivers/new" element={<CreateDriverPage />} />
  <Route path="/admin/drivers/:uid" element={<DriverDetailPage />} />
  <Route path="/admin/drivers/pending" element={<Navigate to="/admin/drivers?status=P" replace />} />
  ```

### 6.5 Reutilización de Spec 2

- `<AuthImage>` se reusa tal cual.
- `multer` ya está; agregar instancia nueva configurada en `helpers/upload-drivers.js` con destino `uploads/drivers/`.
- `validarAdmin` ya está.
- `<SpecialPricingDialog>` se reusa desde el detalle del conductor.

## 7. Cliente API admin

Agregar a `tukytuk-admin/src/api/drivers.ts`:

```ts
export interface DriverWithUser {
  driver: { uid: string; plate: string; locallicense: string; address: string; imageProfile: string; imageDPI1: string; imageDPI2: string; status: 'A'|'R'|'P'; commentsAdmin?: string; specialPrice?: number; specialDurationDays?: number };
  usuario: { uid: string; nombre: string; apellido?: string; email: string; telefono?: string };
}

export interface DriversListResult {
  drivers: DriverWithUser[];
  total: number;
  page: number;
  limit: number;
}

export interface DriversListFilters {
  status?: 'A' | 'R' | 'P';
  search?: string;
  page?: number;
  limit?: number;
}

export async function listDrivers(filters: DriversListFilters = {}, signal?: AbortSignal): Promise<DriversListResult>;
export async function getDriver(uid: string): Promise<DriverWithUser>;
export async function updateDriver(uid: string, data: Partial<{ nombre, apellido, email, telefono, plate, locallicense, address, status, commentsAdmin }>): Promise<DriverWithUser>;
export async function uploadDriverImage(uid: string, tipo: 'perfil'|'dpi1'|'dpi2', file: File): Promise<DriverWithUser>;
```

Todas las funciones usan `apiClient` (no axios crudo) y genéricos en `get<T>`/`put<T>`/`post<T>` para tipar respuestas — mismo patrón del fix del final review del Spec 2.

## 8. Testing

### 8.1 Backend (`tukytukapi/`)

- `tests/admin-drivers-list.test.js`:
  - Sin filtros, paginado correctamente.
  - Filtra por `status='A'`.
  - Búsqueda matchea por nombre/email/placa case-insensitive.
  - Filtros combinados.
  - `limit > 100` se capa.
- `tests/admin-driver-detail.test.js`:
  - 200 con shape esperado.
  - 404 si no existe o no es conductor.
- `tests/admin-driver-update.test.js`:
  - Caso feliz: solo actualiza campos enviados.
  - 409 si email duplicado.
  - 400 si email inválido.
  - 400 si status fuera de enum.
  - 404 si uid no existe.
- `tests/admin-driver-image.test.js`:
  - 400 si tipo inválido.
  - 200 setea el campo correcto.
  - `serveDriverImage`: 200 dueño, 200 admin, 403 otros, 400 filename inválido.

### 8.2 Admin (`tukytuk-admin/`)

Sin framework de tests; disciplina:
- `npm run lint --max-warnings 0`.
- `npm run build` exitoso.

### 8.3 Verificación manual (golden path)

1. **Directorio:** entrar a `/admin/drivers`. Chip "Aprobados" activo por defecto. Cambiar a "Pendientes" → solo pendientes; aprobar inline.
2. **Búsqueda:** "juan" → debounce 300 ms → coincidencias con paginación correcta.
3. **Editar:** click "Editar" → detalle. Cambiar teléfono y guardar → SnackBar de éxito.
4. **Email:** cambiar email → dialog de confirmación. Confirmar → backend recibe y actualiza.
5. **Email duplicado:** intentar email existente → 409, error inline en el campo.
6. **Imágenes:** subir JPG válido como perfil → reemplaza preview. Subir PDF → backend rechaza, SnackBar de error.
7. **Ir a pagos:** desde fila o desde detalle → `/admin/pagos?driverUid=<uid>` con autocomplete pre-seleccionado y filtro aplicado.
8. **Autocomplete:** ir a `/admin/pagos/nuevo` → tipear nombre → seleccionar → crear pago. El uid se envía sin que el admin lo haya visto.
9. **Breadcrumb:** `/admin/pagos/nuevo` muestra `Inicio › Pagos › Nuevo pago`. Click "Pagos" vuelve al listado. Click ← vuelve a Pagos.
10. **Pending compatibilidad:** navegar a `/admin/drivers/pending` directamente → redirect a `/admin/drivers?status=P`.

## 9. Criterios de aceptación

- [ ] Ninguna pantalla del admin pide `driverUid` como texto crudo; todas usan `<DriverAutocomplete>`.
- [ ] La búsqueda funciona por nombre, apellido, email y placa.
- [ ] `/admin/drivers` lista paginada de 20 con filtro por status y búsqueda.
- [ ] Cada fila tiene "Editar" e "Ir a pagos"; filas en `P` además tienen "Aprobar" / "Rechazar".
- [ ] El detalle permite editar todos los campos planeados (incluye email con confirmación).
- [ ] El detalle permite subir imágenes de perfil, DPI1 y DPI2.
- [ ] El email no se puede dejar vacío ni duplicar (server 409 mostrado en UI).
- [ ] Todas las pantallas no-raíz tienen `<PageBreadcrumbs>` con flecha ← funcional.
- [ ] El sidebar muestra solo "Conductores" en vez de "Conductores pendientes" + "Crear conductor".
- [ ] `PendingDriversPage.tsx` está eliminado del repo.
- [ ] `/admin/drivers/pending` redirige a `/admin/drivers?status=P`.
- [ ] Tests backend nuevos pasan; `npm test` completo sigue OK; admin lint y build limpios.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `aggregate` con `$lookup` se vuelve lento con muchos conductores | Índices nuevos: `Driver { plate: 1 }`, `Driver { status: 1, usuario: 1 }`. `Usuario { email: 1 }` ya existe. Paginación con `limit ≤ 100` |
| Subida de imágenes llena el disco | Mismo límite de 5 MB que comprobantes. A futuro mover a S3 cuando se migre todo el storage |
| Admin cambia email mientras el conductor está logueado | El JWT actual no contiene email; sigue válido. El nuevo email aplica al próximo login |
| Admin navega manualmente a `/admin/drivers/pending` (bookmark) | Redirect declarado en el router |
| `<DriverAutocomplete>` dispara muchas requests si el admin tipea rápido | Debounce 300 ms + AbortController para cancelar la previa |
| Subir imagen muy grande tarda y el admin sale | `CircularProgress` + botón disabled. Si se desmonta, el upload puede completarse pero el `onUploaded` no dispara |
| Falla a mitad de update (Usuario OK, Driver falla) | Sin transacción explícita. El admin verá el error y puede reintentar. El daño es mínimo y reversible |

## 11. Despliegue

- **Backend:** deploy a `52.87.214.235`. Crear carpeta `uploads/drivers/` con permisos del proceso Node antes del primer upload. Sin migración de datos. Crear índices Mongoose nuevos (Mongoose los crea automáticamente al cargar el schema).
- **Admin:** `npm run build`, deploy del bundle estático. Sin variables de entorno nuevas.
- **App Flutter:** sin cambios para este spec.
- **Orden recomendado:** backend → admin. El admin viejo seguiría funcionando con el backend nuevo (los endpoints viejos no se tocan); el admin nuevo requiere el backend nuevo. Deploy backend primero permite rollback del admin si hace falta.
- **Comunicación previa:** ninguna requerida; los cambios son internos del portal.
