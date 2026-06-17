# Conductor: home con viaje activo + drawer safe area + ruta en estado P

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** App Flutter conductor + backend Node — tres bugs distintos en el flujo del conductor.

## Problemas

1. **Home conductor sin info cuando hay viaje en progreso.** Cuando el conductor tiene un viaje en estado A o P (asignado / en progreso), `HomePage` no muestra ese viaje en ninguna parte y aún así sigue mostrando la lista de viajes disponibles para aceptar. El conductor no sabe que tiene un viaje en curso y podría aceptar otro, lo cual viola la regla del negocio: **un conductor solo puede tener UN viaje activo a la vez**.
2. **Drawer izquierdo se solapa con la barra de navegación Android.** Los items inferiores del drawer quedan debajo de los botones del sistema y no son tocables.
3. **`MapDriverScreen` en estado P no muestra ruta ni ubicación del conductor.** El método `_loadDriverRoutes` salta el cómputo si el status no es S o A; en P queda sin polylines ni marker del conductor.

## Solución

Tres fixes coordinados en cinco archivos (dos backend, tres frontend), todos en el dominio del conductor.

---

### Fix 1: Home con viaje activo del conductor

#### Backend `tukytukapi/controllers/trip.js`

**a) Arreglar dos bugs en `getDriverActiveTrip`** (línea ~163):

```js
const trip = await Trip.findOne({ $and: [{driver: req.uid, driver_status: ["R", "P"]}]});
//                                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^
// Bug A: query con array literal (no $in) — Mongoose lo trata como valor escalar.
//        Nunca encuentra trip aunque exista uno con driver_status=R o P.
if (!trip) { return res.status(200).json({ ok: false, msg: 'Trip no encontrado', trip: [] }); }
const usuario = await usuario.findOne({ ... });
//        ^^^                ^^^^^^^
// Bug B: usa `usuario` antes de declararlo — ReferenceError en runtime.
//        Probablemente debió ser el modelo `Usuario`.
```

Fix de ambos:

```js
const trip = await Trip.findOne({ driver: req.uid, driver_status: { $in: ['R', 'P'] } });
if (!trip) { return res.status(200).json({ ok: false, msg: 'Trip no encontrado', trip: null }); }
const usuarioDoc = await Usuario.findOne({ _id: trip.usuario });
res.json({ ok: true, msg: 'Trip encontrado', trip, usuario: usuarioDoc });
```

(Si `Usuario` no está importado al inicio del archivo, agregarlo: `const Usuario = require('../models/usuario');`.)
También cambiar `trip: []` por `trip: null` para que el cliente Flutter, que hace `tripResponseFromJson`, no intente decodear un array como Trip.

**b) Defensa en `getDriverListTrip`:** si el conductor ya tiene trip con `driver_status` ∈ {R, P}, retornar `trips: []`. Garantiza que la regla del negocio se cumple aunque el cliente esté en versión vieja.

```js
const activo = await Trip.findOne({ driver: req.uid, driver_status: { $in: ['R', 'P'] } });
if (activo) return res.json({ ok: true, msg: 'Conductor con viaje activo', trips: [] });
// ... resto del query existente
```

#### Frontend `tukytuk/lib/services/trip_service.dart`

Nuevo método `getDriverActiveTrip()` similar a `getUserTripActive()`:

```dart
Future<Trip?> getDriverActiveTrip() async {
  try {
    final resp = await http.get(
      Uri.parse('${Constants.apiUrl}/trip/driver/tripActive/x'),
      headers: { 'Content-Type': 'application/json', 'x-token': (await AuthService.getToken()) ?? '' },
    );
    final response = tripResponseFromJson(resp.body);
    return response.trip;
  } catch (e) {
    return null;
  }
}
```

(El `:uid` de la ruta es ignorado por el backend — `req.uid` viene del JWT. Pasamos `x` como dummy para satisfacer la URL.)

#### Frontend `tukytuk/lib/pages/home_page.dart`

**Estado**: agregar `Trip? _driverActiveTrip`.

**`_cargarUsuarios()`** — al inicio, consultar el viaje activo del conductor:

```dart
final driverActive = await tripService.getDriverActiveTrip();
if (driverActive != null && (driverActive.uid ?? '').isNotEmpty) {
  _driverActiveTrip = driverActive;
  usuarios.clear();           // ocultar lista disponible
  authService.setTrip(driverActive);
  authService.setTripActivated(true);
  authService.setUserStatus(driverActive.userStatus ?? '');
} else {
  _driverActiveTrip = null;
  // flujo actual: getDriverListTrip()
}
```

**Render**: cuando `_driverActiveTrip != null`, mostrar un card prominente en lugar de la lista "Viajes Disponibles":

```
┌────────────────────────────────────────┐
│ 🚕 Viaje en curso                       │
│ Estado: Yendo a recoger / En viaje      │
│ Origen: lat,lng                         │
│ Destino: lat,lng                        │
│ [ Continuar viaje ]  → loading_driver   │
└────────────────────────────────────────┘
```

El botón "Continuar viaje" navega a `loading_driver` (que ya maneja `MapDriverScreen`). El widget queda dentro del mismo `SmartRefresher`/`SingleChildScrollView` existente.

Cuando `_driverActiveTrip == null`, mantener la sección "Viajes Disponibles" tal cual está hoy.

---

### Fix 2: Drawer respeta el safe area inferior

**`tukytuk/lib/widgets/drawer.dart`**

El `Drawer` actual usa `ListView` con un header de altura `0.25` y un `SizedBox(height: 0.75)` con `Column`. Los items inferiores quedan tapados por la barra de navegación Android.

Envolver el contenido del `Drawer` en `SafeArea(top: false, bottom: true, child: ...)`. Mantenemos `top: false` porque el `UserAccountsDrawerHeader` debe pegarse al borde superior; el padding inferior asegura que el item de "Cerrar sesión" (o el último visible) quede por encima de los controles Android.

Si el contenido inferior ya está cerca del límite del `SizedBox(0.75)`, también reducir la altura para considerar `MediaQuery.viewPadding.bottom`.

---

### Fix 3: `MapDriverScreen` dibuja ruta en estado P

**`tukytuk/lib/screens/map_driver_screen.dart`** — `_loadDriverRoutes`:

```dart
final status = authService.userStatus;
if (status != 'S' && status != 'A' && status != 'P') {  // antes solo S y A
  debugPrint('MapDriverScreen: status=$status, no calculo rutas');
  return;
}
```

Sin más cambios: el render existente con dos polylines (naranja conductor→recogida + azul recogida→destino) y tres markers (conductor azure, recogida naranja, destino rojo) aplica también para estado P, per decisión del usuario.

**Sobre la ubicación del conductor en pantalla**: `MapView` ya tiene `myLocationEnabled: true` (punto azul nativo de Google Maps). Adicionalmente, mi marker custom azure se dibuja al entrar `_loadDriverRoutes` exitosamente. Con P ahora incluido, el marker aparece. Si el punto azul nativo no aparece, sería un problema de permisos en runtime — fuera del alcance de este fix; se diagnosticará si persiste.

---

## Archivos modificados

| Archivo | Cambios |
|---|---|
| `tukytukapi/controllers/trip.js` | Arreglar bug `usuario`/`Usuario` en `getDriverActiveTrip`; filtro defensivo en `getDriverListTrip` |
| `tukytuk/lib/services/trip_service.dart` | Nuevo método `getDriverActiveTrip()` |
| `tukytuk/lib/pages/home_page.dart` | Campo `_driverActiveTrip`, lógica en `_cargarUsuarios`, render de card |
| `tukytuk/lib/widgets/drawer.dart` | Envolver contenido en `SafeArea` |
| `tukytuk/lib/screens/map_driver_screen.dart` | Agregar `'P'` al guard de `_loadDriverRoutes` |

## Fuera de alcance

- Re-trigger automático de `_loadDriverRoutes` si el status cambia mid-screen (S→A→P). El render es el mismo para los tres estados; no requiere refresh.
- ETA o distancia en tiempo real en el card de viaje activo (solo info estática del trip).
- Cancelación de viaje por conductor.
- Diagnóstico profundo del punto azul nativo de Google Maps si no aparece.

## Criterio de aceptación

1. Conductor con viaje en estado A o P entra a `HomePage`: ve un card "Viaje en curso" con info del trip y botón "Continuar viaje". NO ve la lista de viajes disponibles.
2. Conductor sin viaje activo: ve la lista de viajes disponibles como hoy. Si tiene viaje pasivo del lado pasajero, esa sección existente sigue funcionando.
3. Aunque un cliente vulnerable consulte `/trip/driver/listTrip` con un viaje activo, el backend responde `trips: []`.
4. Drawer izquierdo: todos los items son tocables, ninguno tapa los controles Android.
5. Conductor con viaje en estado P entra a `MapDriverScreen`: ve las dos polylines (naranja + azul) y los tres markers, igual que en estado S/A.
