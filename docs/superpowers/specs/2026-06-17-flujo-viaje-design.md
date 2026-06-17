# Spec 1 — Flujo de viaje completo y robusto

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Backend (`tukytukapi/`) + App Flutter (`tukytuk/`)

## 1. Objetivo

Que el loop de viaje completo (solicitud → asignación → tránsito → finalización) sea funcional, robusto y con sincronización casi en tiempo real entre pasajero y conductor.

### Problemas que resuelve

1. El autocomplete de direcciones (Mapbox) no maneja errores y puede colgar la app.
2. El pasajero no puede cancelar mientras espera conductor.
3. La pantalla del conductor muestra datos mock (`Juan Pérez`, `María Rodríguez`) en vez de viajes reales (`tukytuk/lib/pages/trip_driver_page.dart:21-47`).
4. El conductor no puede ver la ruta, tiempo ni distancia del viaje antes de aceptar.
5. No existe la opción de rechazar viaje desde el conductor.
6. Durante el viaje en curso, ninguno de los dos ve la ubicación del otro en el mapa.

## 2. Principios

- **La app nunca se cuelga.** Toda llamada externa (Mapbox, sockets, REST) está envuelta en try/catch y degrada elegantemente con mensaje + alternativa visible al usuario.
- **Sockets para acciones críticas, polling como red de seguridad.** Los eventos `trip-*` y `location-update` notifican al instante; el polling actual de viaje se mantiene como fallback de consistencia pero relajado a 5s en lugar de 2s. No reemplazamos todo el polling de un solo golpe — eso será una migración posterior.
- **Una sola fuente de verdad: el backend.** El cliente nunca decide localmente si un viaje está activo; siempre consulta o reacciona a un evento del backend.
- **Cambios mínimos al modelo `Trip`** para no romper datos existentes ni requerir migración.

## 3. Fuera de alcance

Cada uno tendrá (o no) su propia iteración separada:

- Rating de conductor y de pasajero.
- Historial y reportes de viajes.
- Cálculo y cobro de tarifa.
- Fallback automático de geocoding a Google Places si Mapbox falla.
- Sistema de penalizaciones por cancelar.
- Sustitución total del polling por sockets.
- Mapas/geocoding offline.
- Servicio en foreground para seguir emitiendo ubicación con la app en background.

## 4. Cambios al modelo de datos

### 4.1 `tukytukapi/models/trip.js`

Cambios aditivos, retrocompatibles, sin migración:

```js
user_status: {
  type: String,
  enum: ['S', 'A', 'P', 'F', 'C'],   // + 'C' = Cancelado por el pasajero
  default: 'S',
},
rejectedBy: {
  type: [String],                    // uids de conductores que rechazaron
  default: [],
},
cancelledAt: { type: Date },         // se llena cuando user_status pasa a 'C'
```

`driver_status` no cambia (`P` / `R` / `F`).

### 4.2 Por qué nuevo estado `C` en vez de reusar `F`

- `F` significa "completado con éxito"; mezclarlo con cancelación contamina cualquier reporte futuro.
- Permite queries explícitas en admin (futuro): `user_status: 'C'`.
- Aditivo: ningún viaje histórico tiene `C`, los queries existentes no se ven afectados.

### 4.3 Cambios al query del listado del conductor

`controllers/trip.js` → `getDriverListTrip`:

Antes:
```js
Trip.find({ user_status: 'S', user: { $ne: driverUid } })
```

Después:
```js
Trip.find({
  user_status: 'S',
  user: { $ne: driverUid },
  rejectedBy: { $ne: driverUid }
})
```

### 4.4 Índice compuesto recomendado

```js
TripSchema.index({ user_status: 1, user: 1, rejectedBy: 1 });
```

Acelera el listado que el conductor consultará con frecuencia.

### 4.5 Validaciones del modelo (en controllers)

- No se puede cancelar un viaje que no esté en `S`: 409.
- Un conductor en `rejectedBy` de un viaje no puede aceptarlo: 409.
- Idempotencia del rechazo: uso `$addToSet`, no `$push`.

## 5. Endpoints REST

Todos siguen el patrón existente: `routes/trip.js` define `[ check(...), validarCampos, validarJWT ]` antes del controller.

### 5.1 Nuevos

#### `PUT /api/trip/user/cancelTrip`

- **Auth:** JWT (`x-token`). El `uid` del pasajero sale del token.
- **Body:** `{ tripId: string }` (mongoId, requerido).
- **Lógica:**
  - Busca el viaje. Si no existe → 404.
  - Si `trip.user !== req.uid` → 403.
  - Si `trip.user_status !== 'S'` → 409.
  - Si todo bien: `user_status: 'C'`, `cancelledAt: new Date()`.
- **Side-effects socket:** ninguno (en `S` aún no hay conductor asignado).
- **Respuesta:** `{ ok: true, trip }`.

#### `PUT /api/trip/driver/rejectTrip`

- **Auth:** JWT. Valida en el controller que el usuario tenga `type === 'C'`.
- **Body:** `{ tripId: string }` (mongoId, requerido).
- **Lógica:** `Trip.updateOne({ _id: tripId, user_status: 'S' }, { $addToSet: { rejectedBy: driverUid } })`. Si `matchedCount === 0` → 409 ("viaje no disponible").
- **Side-effects socket:** ninguno.
- **Respuesta:** `{ ok: true }`.

### 5.2 Cambios a endpoints existentes

#### `PUT /api/trip/driver/acceptTrip`

- Validación nueva: si `tripId` está en `rejectedBy` con `driverUid` → 409.
- Emite socket `trip-accepted` a la sala del pasajero con el `trip` actualizado.

#### `PUT /api/trip/driver/statusTrip`

- Cuando `driver_status` pasa a `P` o `F`, emite socket `trip-status-changed` a la sala del pasajero con `{ tripId, user_status, driver_status }`.

### 5.3 Resumen tabular

| Método | Ruta | Auth | Body | Side-effects |
|---|---|---|---|---|
| `PUT` | `/api/trip/user/cancelTrip` | JWT | `{tripId}` | `user_status: 'C'`, `cancelledAt` |
| `PUT` | `/api/trip/driver/rejectTrip` | JWT (conductor) | `{tripId}` | `$addToSet rejectedBy` |
| `PUT` | `/api/trip/driver/acceptTrip` | JWT (conductor) | `{tripId, start}` | Socket `trip-accepted` |
| `PUT` | `/api/trip/driver/statusTrip` | JWT (conductor) | `{tripId, status}` | Socket `trip-status-changed` |

### 5.4 Manejo de errores en controllers

Patrón uniforme:

```js
try {
  ...
  res.json({ ok: true, ... });
} catch (err) {
  logger.error('cancelTrip', { uid: req.uid, err: err.message });
  res.status(500).json({ ok: false, msg: 'Error interno' });
}
```

## 6. Eventos Socket.IO

### 6.1 Modelo de salas

Sin cambios. Cada usuario se une a una sala con su `uid` al conectarse (`tukytukapi/sockets/socket.js:6-39`). Emitir a un usuario específico: `io.to(uid).emit(...)`.

### 6.2 Eventos del backend hacia el cliente

| Evento | Audiencia | Payload | Disparado por |
|---|---|---|---|
| `trip-accepted` | Sala del pasajero | `{ trip }` | Controller `acceptTrip` |
| `trip-status-changed` | Sala del pasajero | `{ tripId, user_status, driver_status }` | Controller `statusTrip` |
| `location-update` | Sala de la contraparte | `{ tripId, role: 'driver'\|'passenger', lat, lng, ts }` | Re-emisión del handler `location-update` del backend |

### 6.3 Eventos del cliente hacia el backend

| Evento | Quién emite | Payload | Acción del backend |
|---|---|---|---|
| `location-update` | Pasajero y conductor durante el viaje | `{ tripId, lat, lng }` | Valida pertenencia al viaje, re-emite a la sala de la contraparte. **No persiste en BD** en esta iteración. |

### 6.4 Ciclo de vida de `location-update`

- **Pasajero:** emite desde que recibe `trip-accepted` hasta que recibe `trip-status-changed` con `driver_status: 'F'`. (En esta iteración el pasajero no puede cancelar después de `S`, así que no hay rama de "stop por cancelación"; defensa-en-profundidad en el cliente igualmente.)
- **Conductor:** emite desde que su `acceptTrip` responde OK hasta que él mismo cambia `driver_status` a `F`.

### 6.5 Implementación backend (boceto)

```js
// tukytukapi/sockets/socket.js (handler agregado dentro de 'connection')
client.on('location-update', async ({ tripId, lat, lng }) => {
  try {
    const uid = client.handshake.headers['x-token']; // ya verificado en connection
    const trip = await Trip.findById(tripId).lean();
    if (!trip) return;
    const isUser = String(trip.user) === uid;
    const isDriver = String(trip.driver) === uid;
    if (!isUser && !isDriver) return;
    if (trip.user_status === 'C' || trip.user_status === 'F') return;
    const counterpart = isUser ? trip.driver : trip.user;
    if (!counterpart) return;
    const role = isUser ? 'passenger' : 'driver';
    io.to(String(counterpart)).emit('location-update', {
      tripId, role, lat, lng, ts: Date.now()
    });
  } catch (err) {
    logger.warn('location-update fail', err.message);
  }
});
```

### 6.6 Seguridad

- El backend deriva el `role` del `uid`, nunca lo confía al cliente.
- Si el viaje está cancelado o finalizado, ignora la emisión.
- Si el `uid` no pertenece al viaje, ignora silenciosamente.

### 6.7 Frecuencia y filtrado en cliente

- Emisión cada 3 segundos.
- Solo se emite si la posición actual se movió ≥ 10 m respecto a la última emitida (evita ruido en semáforos).

## 7. Cambios en la app Flutter

### 7.1 Búsqueda de destino — manejo de errores

**Archivos tocados:**
- `tukytuk/lib/blocs/search/search_bloc.dart:57-62` (`getPlacesByQuery`)
- `tukytuk/lib/delegates/search_destination_delegate.dart:37-93`
- `tukytuk/lib/services/places_intercerptor.dart` (token a `.env`)
- `tukytuk/.env` (agregar `MAPBOX_TOKEN`)
- `tukytuk/lib/const/general.dart` (exponer `Constants.mapboxToken` desde `.env`)

**Cambios:**

- `SearchState` gana `SearchStatus { initial, loading, ok, failed }` y un campo `reason: String?`.
- `getPlacesByQuery` envuelve la llamada en try/catch:

  ```dart
  emit(state.copyWith(status: SearchStatus.loading));
  try {
    final places = await trafficService.getResultsByQuery(...);
    emit(state.copyWith(places: places, status: SearchStatus.ok));
  } on DioException catch (e) {
    emit(state.copyWith(status: SearchStatus.failed, reason: _mapError(e)));
  } catch (_) {
    emit(state.copyWith(status: SearchStatus.failed, reason: 'error_desconocido'));
  }
  ```

- `_mapError` traduce:
  - 401/403 → `"Servicio de búsqueda no disponible. Coloca tu destino manualmente."`
  - 429 → `"Demasiadas consultas. Intenta en un momento."`
  - sin red → `"Sin conexión. Revisa tu internet."`
  - otros → `"No pudimos buscar direcciones. Coloca tu destino manualmente."`

- `SearchDestinationDelegate.buildResults` reacciona al estado:
  - `loading` → spinner centrado.
  - `failed` → banner con el `reason` + botón resaltado "Colocar destino manualmente en el mapa" (ya existe en `:86-93`).
  - `ok` → lista normal de resultados.

### 7.2 Pantalla del pasajero — botón Cancelar

**Archivos tocados:**
- `tukytuk/lib/screens/map_screen.dart:132-171` (Column de FABs)
- `tukytuk/lib/widgets/btn_primary.dart` (reusar)
- `tukytuk/lib/services/trip_service.dart` (agregar `cancelTrip(tripId)`)

**Cambios:**

- En la Column de FABs, cuando `userStatus == 'S'`, agregar un `btnPrimary` rojo "Cancelar viaje" arriba del botón de chat.
- Al tap → `AlertDialog` de confirmación: `"¿Cancelar la búsqueda de conductor?"`.
- Si confirma → `tripService.cancelTrip(tripId)`. En éxito: limpiar `activeTrip` local, volver a la vista de "¿A dónde vas?", `SnackBar` `"Viaje cancelado"`. En error: `SnackBar` `"No se pudo cancelar, intenta de nuevo"`.

### 7.3 Pantalla del conductor — listado real + preview de ruta

**Archivos tocados:**
- `tukytuk/lib/pages/trip_driver_page.dart:21-47` — **borrar el mock data completo**.
- `tukytuk/lib/services/trip_service.dart` — verificar/agregar `getDriverListTrip()` (`GET /api/trip/driver/listTrip`).
- `tukytuk/lib/blocs/search/search_bloc.dart:30-54` (`getCoorsStartToEnd`) — reusar.
- `tukytuk/lib/screens/map_driver_screen.dart` — habilitar polyline en preview.
- Nuevo widget de BottomSheet (puede vivir como `tukytuk/lib/widgets/trip_preview_sheet.dart`) que reciba el `Trip` y se muestre con `showModalBottomSheet`.

**Cambios:**

- `TripDriverPage` consulta la lista real con un `FutureBuilder` (o pequeño `Cubit`) cada 5s. Cada card muestra: origen, destino, distancia haversine simple (cálculo local rápido), botón "Ver ruta".
- "Ver ruta" abre un BottomSheet grande con:
  - Mapa con polyline calculada por `getCoorsStartToEnd(start, end)`.
  - Tiempo y distancia que devuelve Mapbox.
  - Botones grandes "Aceptar" (verde) y "Rechazar" (rojo), `btnPrimary`.
- Aceptar → `tripService.setDriverAcceptTrip(tripId, currentCoords)`. Si OK, navega a `map_driver_screen` con el viaje activo.
- Rechazar → `tripService.rejectTrip(tripId)`. Si OK, cierra el sheet y refresca la lista (ese viaje ya no aparece).

### 7.4 Pantalla del conductor — durante el viaje

**Archivos tocados:**
- `tukytuk/lib/screens/map_driver_screen.dart:96-122`
- `tukytuk/lib/services/socket_service.dart.dart` (renombrar a `socket_service.dart`)

**Cambios:**

- Al entrar a la pantalla con un viaje aceptado: `socketService.startEmittingLocation(tripId, 'driver')`.
- Suscribe a `socketService.locationUpdates` filtrado por `role == 'passenger'` y mueve el marcador del pasajero.
- En `dispose` o cuando `driver_status` pasa a `F`: `socketService.stopEmittingLocation()`.

### 7.5 Pantalla del pasajero — durante el viaje

**Archivos tocados:**
- `tukytuk/lib/screens/map_screen.dart`

**Cambios:**

- Al recibir `trip-accepted` por socket: `socketService.startEmittingLocation(tripId, 'passenger')`.
- Suscribe a `locationUpdates` filtrado por `role == 'driver'`. La ruta origen→destino se mantiene fija.
- Al recibir `trip-status-changed` con `F` o al cancelar: `stopEmittingLocation()`.

### 7.6 Cambios cross-cutting

- **Renombrar `socket_service.dart.dart` → `socket_service.dart`.** Doble extensión a corregir mientras tocamos el archivo.
- **`tukytuk/.env`:** agregar `MAPBOX_TOKEN=...` y documentar en el README de `tukytuk/`.
- **Polling del estado del viaje** (`map_screen.dart:59-84`, `map_driver_screen.dart:59-71`): bajar de 2000ms a 5000ms. Los eventos socket cubren la baja latencia; el polling queda como red de seguridad.

## 8. Testing

### 8.1 Backend (`tukytukapi/`)

Tests unitarios nuevos:

- `cancelTrip`:
  - Caso feliz `S` → `C`, `cancelledAt` se llena.
  - 409 si `user_status !== 'S'`.
  - 403 si `trip.user !== req.uid`.
  - 404 si el viaje no existe.
- `rejectTrip`:
  - Caso feliz: agrega `driverUid` a `rejectedBy`.
  - Idempotencia: rechazar dos veces no duplica.
  - 409 si el viaje ya no está en `S`.
- `acceptTrip`:
  - 409 si `driverUid` está en `rejectedBy`.
  - Stub de `io.emit` para verificar `trip-accepted`.
- `getDriverListTrip`:
  - Viajes con `driverUid` en `rejectedBy` no aparecen.
- `statusTrip`:
  - Stub de `io.emit` para verificar `trip-status-changed` cuando pasa a `P` o `F`.

### 8.2 Flutter (`tukytuk/`)

- Widget test del botón Cancelar: aparece solo cuando `userStatus == 'S'`; dispara el diálogo; llama al servicio en confirmar.
- Widget test del card del conductor: muestra origen/destino/distancia; los botones aceptar/rechazar llaman al servicio correcto.
- Test unitario del `SearchBloc`: estados `loading` / `ok` / `failed` con el mapeo de errores Dio correcto.
- No agregamos tests para el flujo socket en esta iteración (alto costo / bajo valor por ahora).

### 8.3 Verificación manual (golden path)

Antes de cerrar la implementación, recorrer estos flujos en celular o emulador con backend de dev y un par de usuarios reales:

1. **Autocomplete con error simulado:** invalidar token Mapbox → banner + opción manual funciona. App no crashea.
2. **Cancelar mientras busca:** pasajero solicita, ve "Solicitando", cancela, confirma → vuelve a home, viaje en BD queda como `C`.
3. **Conductor ve viaje real:** pasajero solicita, conductor abre app y ve el viaje real (no mock). El detalle muestra polyline, tiempo y distancia.
4. **Conductor rechaza:** rechaza → el viaje desaparece de su lista. Otro conductor desde su sesión SÍ lo ve.
5. **Conductor acepta:** acepta → pasajero ve "Conductor en camino" al instante (< 1s, vía socket).
6. **Viaje en curso:** conductor inicia viaje → ambos ven mutuamente la ubicación moviéndose con latencia ≤ 3s.
7. **Finalización:** conductor finaliza → ambos vuelven a su pantalla principal limpia.

## 9. Criterios de aceptación

- [ ] Ningún error de Mapbox cuelga ni crashea la app: siempre hay mensaje + alternativa.
- [ ] El botón Cancelar aparece solo en estado `S` y funciona.
- [ ] La pantalla del conductor muestra viajes reales (cero datos mock en el archivo).
- [ ] Antes de aceptar, el conductor ve polyline, distancia y tiempo del viaje.
- [ ] Aceptar y Rechazar funcionan y persisten correctamente.
- [ ] El pasajero recibe la notificación de "aceptado" en menos de 1 segundo (vía socket).
- [ ] Durante el viaje en curso, ambos ven al otro moverse en el mapa con latencia ≤ 3 segundos.
- [ ] Todos los tests unitarios nuevos pasan.
- [ ] `flutter analyze` sin warnings nuevos.
- [ ] `npm test` del backend pasa.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Token Mapbox vencido en producción | Validar el token actual antes del build de la app; si no funciona, generar uno nuevo y subirlo al `.env` del cliente Flutter (el backend no usa Mapbox) |
| Sobrecarga de `location-update` con muchos viajes simultáneos | Filtro de ≥10 m + 3 s ya reduce; backend no persiste; sala por uid asegura fanout O(1) |
| Red intermitente del conductor | El polling de 5s sigue siendo fallback de estado del viaje; el marcador puede congelarse pero la lógica del viaje no se rompe |
| Conductor cierra la app durante `P` | Fuera de alcance de este spec. Issue futuro: servicio en foreground (Android) para que sobreviva al backgrounding |
| Dependencia circular `index.js ↔ sockets/socket.js` | Ya existe en el repo. El handler nuevo se agrega al mismo `sockets/socket.js`, no se introduce nada nuevo en el grafo |

## 11. Despliegue

- **Backend:** deploy estándar a `52.87.214.235`. No requiere migración de datos (los campos nuevos son aditivos con defaults).
- **Admin web:** sin cambios para este spec.
- **App Flutter:** build nuevo APK; subir token Mapbox a `.env` antes de compilar.
- **Orden recomendado:** backend primero (los endpoints nuevos son aditivos y no rompen clientes viejos), luego app.
