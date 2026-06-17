# Pasajero: ruta y ubicación del conductor en tiempo real

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Flutter app — `lib/screens/map_screen.dart` (pantalla del pasajero).

## Problema

En la pantalla donde el pasajero espera que llegue el conductor (estado A) y mientras va en viaje (estado P), no se ve:
- La ubicación del conductor en el mapa.
- Ninguna ruta (ni "conductor viene hacia mí", ni "voy hacia el destino").

El usuario solo ve el mapa OSM/Google Maps base, sin información del viaje activo. Esto es simétrico al bug que ya arreglamos en `MapDriverScreen` (conductor sin ruta) — ahora el lado del pasajero también lo necesita.

## Causa raíz

`map_screen.dart` YA tiene la infraestructura:
- Suscripción a `socket.locationUpdatesStream` filtrando `role: 'driver'` (línea 91), que actualiza `_driverMarker`.
- Render condicional de markers/polylines gated por `authService.tripActivated` (líneas 217-225).

Lo que falta:
- **Cálculo de rutas**: el `MapBloc.state.polylines` solo se llena cuando el pasajero buscó destino al inicio. No hay ningún path que dibuje "conductor → recogida" o sincronice con el conductor en tiempo real.
- **Diagnóstico**: si el marker del conductor no aparece tampoco, hay que ver si el socket está entregando eventos. Hoy no hay logs.

## Solución

### Cambios en `map_screen.dart`

**a) Nuevo estado**:
```dart
bool _passengerRoutesLoaded = false;
LatLng? _pickup;
LatLng? _destination;
LatLng? _lastDriverPos;

static const _kRouteA = 'driverToPickupRoute';
static const _kRouteB = 'tripRoute';
static const _kPickupMarker = 'pickupMarker';
static const _kDestinationMarker = 'destinationMarker';
```

(El marker del conductor sigue siendo `_driverMarker` existente, con ID `'driver'`.)

**b) Método nuevo `_loadPassengerRoutes(LatLng driverPos)`**:

Análogo a `_loadDriverRoutes` en `MapDriverScreen`. Llama `SearchBloc.getRoutePreview` dos veces (con try/catch individuales):
- Ruta A: `driverPos → pickup` — color **naranja**, `strokeWidth: 6`.
- Ruta B: `pickup → destination` — color **azul**, `strokeWidth: 6`.

Markers:
- `_kPickupMarker`: marker en `pickup`, `hueOrange`.
- `_kDestinationMarker`: marker en `destination`, `hueRed`.

Despacha `MapBloc.add(DisplayPolylinesEvent(polylines, markers))` mezclando con `mapBloc.state` existente para no borrar el rastro `myRoute`.

Setea `_passengerRoutesLoaded = true`.

**c) Trigger del cómputo en el listener de location updates**:

Modificar el listener `_locUpdSub` (línea 91 actual):

```dart
_locUpdSub = socket.locationUpdatesStream.listen((data) {
  debugPrint('MapScreen: location-update role=${data['role']} '
      'lat=${data['lat']} lng=${data['lng']}');
  if (data['role'] != 'driver') return;
  if (!mounted) return;
  final lat = (data['lat'] as num?)?.toDouble();
  final lng = (data['lng'] as num?)?.toDouble();
  if (lat == null || lng == null) return;
  final driverPos = LatLng(lat, lng);
  setState(() {
    _driverMarker = Marker(
      markerId: const MarkerId('driver'),
      position: driverPos,
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
    );
  });
  _lastDriverPos = driverPos;
  // Primera vez: calcular rutas si estamos en estado A/P.
  if (!_passengerRoutesLoaded) {
    final status = context.read<AuthService>().userStatus;
    if (status == 'A' || status == 'P') {
      _loadPassengerRoutes(driverPos);
    }
  }
});
```

El `debugPrint` es permanente — sirve para diagnosticar el caso donde el socket no entrega eventos (no veríamos NINGÚN log con `location-update`).

**d) Reset al cambiar de status**:

En `_statusSub` (línea 79), agregar: si el `userStatus` cambia desde `S` a `A` (driver acaba de aceptar), resetear `_passengerRoutesLoaded = false` para que la próxima ubicación que llegue dispare el cálculo:

```dart
if (nuevoUserStatus == 'A' && authService.userStatus != 'A') {
  _passengerRoutesLoaded = false;
}
```

**e) Limpieza en `dispose`**:

Después del `cancel()` de las suscripciones, si `_passengerRoutesLoaded == true`, despachar `DisplayPolylinesEvent` con las claves removidas (igual que hicimos en MapDriverScreen):

```dart
if (_passengerRoutesLoaded) {
  final mapBloc = context.read<MapBloc>();
  final polylines = Map<String, Polyline>.from(mapBloc.state.polylines);
  polylines.remove(_kRouteA);
  polylines.remove(_kRouteB);
  final markers = Map<String, Marker>.from(mapBloc.state.markers);
  markers.remove(_kPickupMarker);
  markers.remove(_kDestinationMarker);
  mapBloc.add(DisplayPolylinesEvent(polylines, markers));
}
```

Notar que `_driverMarker` se sigue limpiando porque vive en el `setState` local, no en el MapBloc.

### Coordenadas de pickup y destination

Cuando se entra al screen, leer del `AuthService.trip`:
- `pickup = LatLng(trip.startLat, trip.startLng)`
- `destination = LatLng(trip.endLat, trip.endLng)`

Hacer esto en `initState` después de capturar el `authService`. Si el trip no está cargado o las coords son inválidas, no se intentará calcular ruta — `_loadPassengerRoutes` valida que `_pickup` y `_destination` no sean null.

## Fuera de alcance

- Re-cálculo de la ruta naranja cada vez que el conductor se mueve (saturaría Mapbox). Por ahora se calcula UNA vez al entrar a status A.
- ETA dinámico mostrado al pasajero.
- Investigación profunda del socket si los logs no muestran eventos `location-update role=driver`. Ese sería otro spec si hace falta.
- Tocar `trip_page.dart` (la ruta `trip_passanger` no es la que el pasajero realmente usa hoy — `map_screen` es la viva).

## Criterio de aceptación

1. Pasajero en estado **A** con conductor emitiendo posición:
   - Aparece marker azure del conductor moviéndose en cada tick (3s).
   - Polyline naranja conductor→recogida visible.
   - Polyline azul recogida→destino visible.
   - Marker naranja en pickup, marker rojo en destino.
2. Pasajero en estado **P**: ambas polylines siguen visibles (la naranja queda obsoleta pero no estorba). Marker del conductor sigue moviéndose.
3. En logs aparece `MapScreen: location-update role=driver lat=... lng=...` por cada tick del conductor. Si NO aparece, es bug de socket — fuera de alcance pero queda evidente para diagnóstico.
4. Al salir de la pantalla (dispose), las polylines y markers añadidos por este screen NO quedan residuales en el `MapBloc.state`.
