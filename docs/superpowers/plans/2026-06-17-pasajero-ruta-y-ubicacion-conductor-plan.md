# Pasajero ve ruta y ubicación del conductor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En `lib/screens/map_screen.dart` (pantalla del pasajero), mostrar las dos rutas (conductor→recogida en naranja + recogida→destino en azul) y tres markers cuando el viaje está en estado A o P, con la posición del conductor actualizándose en tiempo real vía socket.

**Architecture:** Cambios confinados a un único archivo. Capturar pickup/destination en `initState`, agregar `debugPrint` y trigger de cómputo al primer location-update del conductor, agregar método `_loadPassengerRoutes` (espejo de `_loadDriverRoutes` del lado conductor), y limpiar polylines/markers en `dispose`. La suscripción socket existente y el `_driverMarker` siguen funcionando como hoy.

**Tech Stack:** Flutter, `google_maps_flutter`, `flutter_bloc` (MapBloc + SearchBloc), `provider` (AuthService + SocketService), Mapbox Directions API.

## Global Constraints

- Idioma: TODO en español — UI, comentarios, mensajes, commits.
- Único archivo modificado: `tukytuk/lib/screens/map_screen.dart`.
- Colores fijos: ruta A (conductor→recogida) **naranja**; ruta B (recogida→destino) **azul**. `strokeWidth: 6`.
- Markers: conductor `hueAzure` (ya existe), pickup `hueOrange`, destino `hueRed`.
- `debugPrint` permanente en el listener de `locationUpdatesStream` con prefijo `MapScreen: location-update role=...`.
- `flutter analyze lib/screens/map_screen.dart` debe pasar sin nuevos errores ni warnings nuevos.
- NO tests para este task — patrón del proyecto, verificación manual al final.
- Spec de referencia: `tukytukapi/docs/superpowers/specs/2026-06-17-pasajero-ruta-y-ubicacion-conductor-design.md`.

---

### Task 1: Estado + diagnóstico de socket + reset al cambio de status

**Files:**
- Modify: `tukytuk/lib/screens/map_screen.dart` (state fields + `initState` setup + listeners)

**Interfaces:**
- Consumes:
  - Existente: `AuthService.trip` (con `startLat/startLng/endLat/endLng` strings), `SocketService.locationUpdatesStream`, `SocketService.tripStatusChangedStream`.
- Produces (consumido por Task 2):
  - `bool _passengerRoutesLoaded` — gate para que `_loadPassengerRoutes` se llame una sola vez por status A/P.
  - `LatLng? _pickup`, `LatLng? _destination` — parseados de `AuthService.trip` en `initState`.
  - `LatLng? _lastDriverPos` — última posición del conductor recibida.
  - Constantes de claves: `_kRouteA = 'driverToPickupRoute'`, `_kRouteB = 'tripRoute'`, `_kPickupMarker = 'pickupMarker'`, `_kDestinationMarker = 'destinationMarker'`.
  - Llamada `_loadPassengerRoutes(driverPos)` desde el listener del socket — Task 2 la implementa, esta task solo la llama y la stub.

- [ ] **Step 1: Agregar campos de estado y constantes**

Abrir `tukytuk/lib/screens/map_screen.dart`. Localizar la declaración del state class (probablemente `_MapScreenState`) y los campos existentes (`locationBloc`, `_timer`, `_driverMarker`, `_acceptedSub`, `_statusSub`, `_locUpdSub`).

Agregar JUSTO DESPUÉS de los campos existentes (antes de `initState`):

```dart
  // Coordenadas clave del viaje, parseadas una vez en initState
  LatLng? _pickup;
  LatLng? _destination;

  // Última posición conocida del conductor — usada para recomputar la ruta naranja
  // si fuera necesario (por ahora se calcula 1 sola vez por status).
  LatLng? _lastDriverPos;

  // Gate para que las rutas naranja+azul se calculen una sola vez por status.
  // Se resetea cuando el status cambia (S→A o se entra al screen en P).
  bool _passengerRoutesLoaded = false;

  // Claves que este screen añade al MapBloc — necesarias para limpiarlas en dispose.
  static const _kRouteA = 'driverToPickupRoute';
  static const _kRouteB = 'tripRoute';
  static const _kPickupMarker = 'pickupMarker';
  static const _kDestinationMarker = 'destinationMarker';
```

- [ ] **Step 2: Parsear pickup/destination en initState**

Localizar `initState()`. Después de `locationBloc.startFollowingUser();` y del `final authService = context.read<AuthService>();` existente (alrededor de línea 53), agregar:

```dart
    // Parsear coords del viaje una sola vez. Si están inválidas, _loadPassengerRoutes
    // las detectará como null y no intentará calcular ruta.
    final trip = authService.trip;
    if (trip != null) {
      final sLat = double.tryParse(trip.startLat ?? '');
      final sLng = double.tryParse(trip.startLng ?? '');
      final eLat = double.tryParse(trip.endLat ?? '');
      final eLng = double.tryParse(trip.endLng ?? '');
      if (sLat != null && sLng != null) _pickup = LatLng(sLat, sLng);
      if (eLat != null && eLng != null) _destination = LatLng(eLat, eLng);
      debugPrint('MapScreen: initState pickup=$_pickup destination=$_destination');
    }
```

- [ ] **Step 3: Modificar el listener de `locationUpdatesStream`**

Localizar el listener actual (aprox. línea 91):

```dart
    // Listener: actualización de ubicación — solo reaccionar al conductor
    _locUpdSub = socket.locationUpdatesStream.listen((data) {
      if (data['role'] != 'driver') return;
      if (!mounted) return;
      final lat = (data['lat'] as num?)?.toDouble();
      final lng = (data['lng'] as num?)?.toDouble();
      if (lat == null || lng == null) return;
      setState(() {
        _driverMarker = Marker(
          markerId: const MarkerId('driver'),
          position: LatLng(lat, lng),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        );
      });
    });
```

Reemplazar por:

```dart
    // Listener: actualización de ubicación — solo reaccionar al conductor.
    // debugPrint permanente para diagnosticar si el socket no entrega eventos.
    _locUpdSub = socket.locationUpdatesStream.listen((data) {
      debugPrint('MapScreen: location-update role=${data['role']} '
          'lat=${data['lat']} lng=${data['lng']}');
      if (data['role'] != 'driver') return;
      if (!mounted) return;
      final lat = (data['lat'] as num?)?.toDouble();
      final lng = (data['lng'] as num?)?.toDouble();
      if (lat == null || lng == null) return;
      final driverPos = LatLng(lat, lng);
      _lastDriverPos = driverPos;
      setState(() {
        _driverMarker = Marker(
          markerId: const MarkerId('driver'),
          position: driverPos,
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        );
      });
      // Primera vez que llega una ubicación del conductor con status A/P:
      // disparar el cálculo de polylines y markers.
      if (!_passengerRoutesLoaded) {
        final status = context.read<AuthService>().userStatus;
        if (status == 'A' || status == 'P') {
          _loadPassengerRoutes(driverPos);
        }
      }
    });
```

- [ ] **Step 4: Resetear `_passengerRoutesLoaded` al cambio de status (S→A)**

Localizar el listener `_statusSub = socket.tripStatusChangedStream.listen(...)` (aprox. línea 79). Estado actual:

```dart
    _statusSub = socket.tripStatusChangedStream.listen((data) {
      if (!mounted) return;
      final nuevoUserStatus = data['user_status'] as String?;
      if (nuevoUserStatus != null) {
        authService.setUserStatus(nuevoUserStatus);
      }
      if (data['driver_status'] == 'F') {
        socket.stopEmittingLocation();
      }
    });
```

Reemplazar por (agregando el reset ANTES de `setUserStatus`):

```dart
    _statusSub = socket.tripStatusChangedStream.listen((data) {
      if (!mounted) return;
      final nuevoUserStatus = data['user_status'] as String?;
      if (nuevoUserStatus != null) {
        // Si el conductor acaba de aceptar (S→A), permitir que la próxima
        // ubicación que llegue dispare el recálculo de rutas.
        if (nuevoUserStatus == 'A' && authService.userStatus != 'A') {
          _passengerRoutesLoaded = false;
        }
        authService.setUserStatus(nuevoUserStatus);
      }
      if (data['driver_status'] == 'F') {
        socket.stopEmittingLocation();
      }
    });
```

- [ ] **Step 5: Stub temporal de `_loadPassengerRoutes`**

Agregar este método justo después de `dispose()` (o donde se mantengan métodos privados del state) — Task 2 lo reemplazará con la implementación real:

```dart
  /// STUB: Task 2 implementa el cómputo real. Por ahora solo registra que se llamaría
  /// y marca el gate como cargado para no llamarlo en bucle si el cálculo real fallara.
  Future<void> _loadPassengerRoutes(LatLng driverPos) async {
    debugPrint('MapScreen: _loadPassengerRoutes stub driver=$driverPos '
        'pickup=$_pickup destination=$_destination');
    _passengerRoutesLoaded = true;
  }
```

- [ ] **Step 6: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/screens/map_screen.dart
```

Esperado: 0 errores. Warnings pre-existentes pueden seguir; ningún warning NUEVO de tu cambio.

- [ ] **Step 7: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_screen.dart
git commit -m "refactor(map-screen): estado y diagnóstico para rutas del pasajero

- Campos para pickup/destination/lastDriverPos y gate _passengerRoutesLoaded.
- Parsea coords del trip en initState.
- debugPrint permanente en listener location-update — diagnostica si el
  socket no entrega eventos.
- Trigger stub de _loadPassengerRoutes en primer location-update con status A/P.
- Reset del gate al cambio S→A vía tripStatusChangedStream.
- Stub temporal de _loadPassengerRoutes — Task 2 implementa el cómputo real."
```

---

### Task 2: Implementar `_loadPassengerRoutes` (cómputo real)

**Files:**
- Modify: `tukytuk/lib/screens/map_screen.dart` (reemplazar el stub por la implementación real)

**Interfaces:**
- Consumes (de Task 1): `_pickup`, `_destination`, `_kRouteA/B`, `_kPickupMarker/_kDestinationMarker`, `_passengerRoutesLoaded` (se mantiene en `true` tras éxito).
- Consumes (codebase existente):
  - `SearchBloc.getRoutePreview(LatLng start, LatLng end) → Future<({List<LatLng> points, double distance, double duration})>` — disponible vía `BlocProvider.of<SearchBloc>(context)`.
  - `MapBloc.add(DisplayPolylinesEvent(polylines, markers))` — disponible vía `BlocProvider.of<MapBloc>(context)`.
- Produces: nada para Task 3 — solo render visible en el mapa.

- [ ] **Step 1: Capturar `_searchBloc` y `_mapBloc` en initState**

Localizar los campos del state class (donde Task 1 añadió `_pickup`, `_destination`, etc.). Agregar:

```dart
  late SearchBloc _searchBloc;
  late MapBloc _mapBloc;
```

En `initState`, justo después de `_locUpdSub = socket.locationUpdatesStream.listen(...)` cerrando el listener (línea aprox. 105 después de Task 1), pero ANTES del cierre de `initState`, agregar:

```dart
    _searchBloc = BlocProvider.of<SearchBloc>(context);
    _mapBloc = BlocProvider.of<MapBloc>(context);
```

(Alternativamente al principio de `initState` después de `locationBloc = ...`. Donde quede más limpio según el flujo del archivo.)

Verificar que el archivo ya importa `SearchBloc` y `MapBloc` (probablemente sí — son los blocs usados en el `build`). Si no, agregar:

```dart
import 'package:tukytuk/blocs/search/search_bloc.dart';
import 'package:tukytuk/blocs/map/map_bloc.dart';
```

- [ ] **Step 2: Reemplazar el stub de `_loadPassengerRoutes` con la implementación real**

Eliminar el stub que Task 1 creó (el método con el solo `debugPrint`) y reemplazar por:

```dart
  /// Calcula las dos rutas que el pasajero necesita ver:
  ///   - Ruta A (naranja): ubicación del conductor → punto de recogida
  ///   - Ruta B (azul):    punto de recogida → destino del viaje
  /// Cada una en su try/catch para que un fallo no tumbe a la otra.
  /// Despacha DisplayPolylinesEvent mezclando con el state existente del MapBloc
  /// (no borra el rastro 'myRoute' ni otros markers que viviesen ahí).
  Future<void> _loadPassengerRoutes(LatLng driverPos) async {
    if (_pickup == null || _destination == null) {
      debugPrint('MapScreen: _loadPassengerRoutes abort — pickup o destination null');
      return;
    }
    final pickup = _pickup!;
    final destination = _destination!;

    debugPrint('MapScreen: _loadPassengerRoutes driver=$driverPos '
        'pickup=$pickup destination=$destination');

    _passengerRoutesLoaded = true;

    final results = await Future.wait([
      _safeRoute(driverPos, pickup, 'A'),
      _safeRoute(pickup, destination, 'B'),
    ]);

    if (!mounted) return;

    final routeA = results[0];
    final routeB = results[1];

    final polylines = Map<String, Polyline>.from(_mapBloc.state.polylines);
    final markers = Map<String, Marker>.from(_mapBloc.state.markers);

    if (routeB != null && routeB.points.length >= 2) {
      polylines[_kRouteB] = Polyline(
        polylineId: const PolylineId(_kRouteB),
        color: Colors.blue,
        width: 6,
        points: routeB.points,
      );
    }

    if (routeA != null && routeA.points.length >= 2) {
      polylines[_kRouteA] = Polyline(
        polylineId: const PolylineId(_kRouteA),
        color: Colors.orange,
        width: 6,
        points: routeA.points,
      );
    }

    markers[_kPickupMarker] = Marker(
      markerId: const MarkerId(_kPickupMarker),
      position: pickup,
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
      infoWindow: const InfoWindow(title: 'Tu punto de recogida'),
    );
    markers[_kDestinationMarker] = Marker(
      markerId: const MarkerId(_kDestinationMarker),
      position: destination,
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
      infoWindow: const InfoWindow(title: 'Destino del viaje'),
    );

    _mapBloc.add(DisplayPolylinesEvent(polylines, markers));
  }

  /// Wrapper de getRoutePreview con try/catch y debugPrint.
  Future<({List<LatLng> points, double distance, double duration})?> _safeRoute(
    LatLng start,
    LatLng end,
    String label,
  ) async {
    try {
      final r = await _searchBloc.getRoutePreview(start, end);
      debugPrint('MapScreen: ruta $label devolvió ${r.points.length} pts, '
          'dist=${r.distance}m');
      return r;
    } catch (e) {
      debugPrint('MapScreen: ruta $label falló: $e');
      return null;
    }
  }
```

- [ ] **Step 3: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/screens/map_screen.dart
```

Esperado: 0 errores, 0 warnings nuevos.

- [ ] **Step 4: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_screen.dart
git commit -m "feat(map-screen): dibuja ruta y markers del viaje para el pasajero

- _loadPassengerRoutes calcula naranja (conductor→recogida) y azul
  (recogida→destino) en paralelo vía SearchBloc.getRoutePreview, cada
  una con try/catch individual.
- Despacha DisplayPolylinesEvent mezclando con el estado existente del
  MapBloc para preservar el rastro 'myRoute' del seguimiento.
- Markers: pickup naranja, destino rojo (el azure del conductor sigue
  viviendo en setState local como antes).
- _safeRoute helper centraliza el wrapping de errores."
```

---

### Task 3: Limpieza en `dispose` + verificación end-to-end

**Files:**
- Modify: `tukytuk/lib/screens/map_screen.dart` (`dispose` cleanup)

**Interfaces:**
- Consumes (de Tasks 1-2): claves `_kRouteA`, `_kRouteB`, `_kPickupMarker`, `_kDestinationMarker`, `_passengerRoutesLoaded`, `_mapBloc`.
- Produces: nada — solo evita estado residual entre pantallas.

- [ ] **Step 1: Actualizar `dispose` para limpiar las claves añadidas**

Localizar `dispose()` (aprox. línea 108 antes del refactor). Estado actual:

```dart
  @override
  void dispose() {
    _acceptedSub?.cancel();
    _statusSub?.cancel();
    _locUpdSub?.cancel();
    context.read<SocketService>().stopEmittingLocation();
    _timer?.cancel();
    locationBloc.stopFollowingUser();
    super.dispose();
  }
```

Reemplazar por:

```dart
  @override
  void dispose() {
    _acceptedSub?.cancel();
    _statusSub?.cancel();
    _locUpdSub?.cancel();
    context.read<SocketService>().stopEmittingLocation();
    _timer?.cancel();
    locationBloc.stopFollowingUser();

    // Limpiar polylines/markers que este screen añadió al MapBloc, para no
    // contaminar el estado del próximo viaje del pasajero.
    if (_passengerRoutesLoaded) {
      final polylines = Map<String, Polyline>.from(_mapBloc.state.polylines);
      polylines.remove(_kRouteA);
      polylines.remove(_kRouteB);
      final markers = Map<String, Marker>.from(_mapBloc.state.markers);
      markers.remove(_kPickupMarker);
      markers.remove(_kDestinationMarker);
      _mapBloc.add(DisplayPolylinesEvent(polylines, markers));
    }

    super.dispose();
  }
```

- [ ] **Step 2: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/screens/map_screen.dart
```

Esperado: 0 errores. Solo warnings pre-existentes.

- [ ] **Step 3: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_screen.dart
git commit -m "fix(map-screen): limpia polylines y markers del pasajero en dispose

Evita que las dos polylines y dos markers añadidos por map_screen
queden residuales en el MapBloc cuando el pasajero sale del flujo."
```

- [ ] **Step 4: `flutter analyze` global**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze
```

Esperado: el archivo `map_screen.dart` no debe contribuir issues nuevos. Si hay alguno, arreglarlo.

- [ ] **Step 5: Probar en dispositivo (manual)**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter run -d R5CT63D67ZM
```

Si falla con `Gradle task assembleDebug failed with exit code 1`: `cd android && ./gradlew --stop`, reintentar.

Flujo:
1. Loguearse como pasajero. Buscar destino, crear viaje.
2. En OTRO dispositivo, loguearse como conductor con suscripción activa. Aceptar el viaje desde la lista o tomarlo desde el card "Viaje en curso".
3. El conductor entra a `MapDriverScreen` — su socket empieza a emitir cada 3s.
4. Volver al dispositivo pasajero. **Verificar en pantalla**:
   - Marker azure del conductor se mueve cada ~3s.
   - Polyline azul entre el pickup del pasajero y el destino.
   - Polyline naranja entre la posición actual del conductor y el pickup del pasajero.
   - Marker naranja en pickup, marker rojo en destino.
5. **Verificar en logs**:
   - `MapScreen: location-update role=driver lat=... lng=...` aparece cada ~3s.
   - `MapScreen: _loadPassengerRoutes driver=... pickup=... destination=...` aparece UNA vez.
   - `MapScreen: ruta A devolvió N pts ...` y `ruta B devolvió M pts ...` aparecen.

- [ ] **Step 6: Si no aparecen logs `location-update role=driver`**

El socket no está entregando eventos. Diagnóstico:
- Confirmar que el conductor está en `MapDriverScreen` (logs `MapDriverScreen: driver=...`).
- Confirmar que ambos dispositivos están conectados al mismo backend (`Constants.socketUrl`).
- Confirmar que `socket.connected == true` en el pasajero (puede agregar `debugPrint(socket.connected)` puntualmente).

Si el problema es socket, ESTÁ FUERA DEL ALCANCE de este plan. Reportar al usuario con los logs para abrir otro spec.

- [ ] **Step 7: Reportar resultados**

Si todo pasa, no se requiere commit adicional. Si hay ajustes, hacer commit aparte:

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_screen.dart
git commit -m "fix(map-screen): ajustes verificados en dispositivo"
```
