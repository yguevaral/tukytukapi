# Doble ruta en TripPreviewSheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en el modal `TripPreviewSheet` (Flutter app conductor) dos rutas simultáneas — conductor→recogida y recogida→destino — con métricas dobles y manejo de errores degradado, además de arreglar la polyline del viaje del pasajero que actualmente no se ve.

**Architecture:** Refactor confinado a `lib/widgets/trip_preview_sheet.dart`. Mantiene `SearchBloc.getRoutePreview` como motor de cálculo. Agrega obtención de ubicación del conductor vía `Geolocator`. Dos llamadas paralelas con `Future.wait` y try/catch individual para que un fallo no tumbe al otro. Render con `FlutterMap` + dos `Polyline` + tres `Marker`.

**Tech Stack:** Flutter, `flutter_map`, `latlong2`, `geolocator`, `google_polyline_algorithm`, `provider`/`flutter_bloc`, Mapbox Directions API (vía `SearchBloc.getRoutePreview`).

## Global Constraints

- Idioma: TODO en español — UI, comentarios, mensajes, commits.
- Único archivo modificado: `tukytuk/lib/widgets/trip_preview_sheet.dart`. No tocar backend, `SearchBloc`, modelos.
- Colores fijos: ruta A (conductor→recogida) **naranja** (`Colors.orange`); ruta B (viaje) **azul** (`Colors.blue`).
- `strokeWidth` ambas polylines: **6** (antes era 4).
- `debugPrint` en `_loadRoute` permanece (es no-op en release).
- Después de cada Task: `flutter analyze` debe pasar sin warnings nuevos.
- Spec de referencia: `docs/superpowers/specs/2026-06-17-trip-preview-doble-ruta-design.md`.

---

### Task 1: Refactor de estado y `_loadRoute` con doble ruta paralela

**Files:**
- Modify: `tukytuk/lib/widgets/trip_preview_sheet.dart` (state class + `_loadRoute`)

**Interfaces:**
- Consumes: `SearchBloc.getRoutePreview(LatLng start, LatLng end) → Future<({List<LatLng> points, double distance, double duration})>` (existente).
- Consumes: `Geolocator.getCurrentPosition(locationSettings: LocationSettings(accuracy: LocationAccuracy.high)) → Future<Position>` (paquete `geolocator`).
- Produces: campos de estado consumidos por Task 2 y 3:
  - `bool _failed` (cuando ruta B falla o coords del viaje inválidas)
  - `bool _loading`
  - `String _failureMessage` (texto exacto a mostrar)
  - `List<LatLng> _routeBPoints` (siempre, viaje pasajero — recogida→destino)
  - `List<LatLng> _routeAPoints` (vacío si no se calculó, conductor→recogida)
  - `LatLng? _driverPos`, `LatLng _pickup`, `LatLng _destination`
  - `double? _distanceAKm, _durationAMin, _distanceBKm, _durationBMin`
  - `bool _showDriverLocationWarning` (para snackbar)

- [ ] **Step 1: Reemplazar campos de estado y agregar imports**

Abrir `tukytuk/lib/widgets/trip_preview_sheet.dart` y:

1. Agregar import al inicio (después de imports existentes):

```dart
import 'package:geolocator/geolocator.dart';
```

2. Reemplazar el bloque de campos privados de `_TripPreviewSheetState` (líneas ~28-33 actuales: `_loading`, `_failed`, `_distanceKm`, `_durationMin`, `_routePoints`) por:

```dart
  bool _loading = true;
  bool _failed = false;
  String _failureMessage = 'No se pudo cargar la ruta del viaje';

  // Ruta B: recogida → destino (la del viaje del pasajero)
  List<LatLng> _routeBPoints = [];
  double? _distanceBKm;
  double? _durationBMin;

  // Ruta A: conductor → recogida (nueva)
  List<LatLng> _routeAPoints = [];
  double? _distanceAKm;
  double? _durationAMin;

  // Puntos clave para markers
  LatLng? _driverPos;
  LatLng? _pickup;
  LatLng? _destination;

  // Flag para mostrar snackbar único si Geolocator falló
  bool _showDriverLocationWarning = false;
```

- [ ] **Step 2: Reescribir `_loadRoute`**

Reemplazar el método `_loadRoute()` completo (líneas ~41-91 actuales) por:

```dart
  /// Carga las dos rutas en paralelo:
  /// - Ruta A: ubicación actual del conductor → punto de recogida (origen del viaje)
  /// - Ruta B: punto de recogida → destino (el viaje del pasajero)
  /// Cada ruta tiene su propio try/catch para que una falla no tumbe la otra.
  Future<void> _loadRoute() async {
    // 1. Parsear coordenadas del viaje
    final sLat = double.tryParse(widget.trip.startLat ?? '');
    final sLng = double.tryParse(widget.trip.startLng ?? '');
    final eLat = double.tryParse(widget.trip.endLat ?? '');
    final eLng = double.tryParse(widget.trip.endLng ?? '');

    if (sLat == null || sLng == null || eLat == null || eLng == null) {
      debugPrint('TripPreviewSheet: coords del viaje inválidas '
          'start=($sLat,$sLng) end=($eLat,$eLng)');
      if (!mounted) return;
      setState(() {
        _failed = true;
        _failureMessage = 'Coordenadas del viaje inválidas';
        _loading = false;
      });
      return;
    }

    _pickup = LatLng(sLat, sLng);
    _destination = LatLng(eLat, eLng);
    final pickupGm = gm.LatLng(sLat, sLng);
    final destinationGm = gm.LatLng(eLat, eLng);

    debugPrint('TripPreviewSheet: pickup=($sLat,$sLng) '
        'destination=($eLat,$eLng)');

    // 2. Obtener ubicación del conductor (no aborta si falla)
    gm.LatLng? driverGm;
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      _driverPos = LatLng(pos.latitude, pos.longitude);
      driverGm = gm.LatLng(pos.latitude, pos.longitude);
      debugPrint('TripPreviewSheet: driver=(${pos.latitude},${pos.longitude})');
    } catch (e) {
      debugPrint('TripPreviewSheet: Geolocator falló: $e');
      _showDriverLocationWarning = true;
    }

    if (!mounted) return;

    // 3. Lanzar ambas rutas en paralelo, cada una con su try/catch
    final searchBloc = context.read<SearchBloc>();

    final futureRouteB = _safeRoute(searchBloc, pickupGm, destinationGm, 'B');
    final futureRouteA = driverGm == null
        ? Future.value(null)
        : _safeRoute(searchBloc, driverGm, pickupGm, 'A');

    final results = await Future.wait([futureRouteA, futureRouteB]);
    final routeA = results[0];
    final routeB = results[1];

    if (!mounted) return;

    // 4. Ruta B es la principal: si falla, todo falla
    if (routeB == null || routeB.points.isEmpty) {
      setState(() {
        _failed = true;
        _failureMessage = 'No se pudo cargar la ruta del viaje';
        _loading = false;
      });
      return;
    }

    // 5. Asignar estado final
    setState(() {
      _routeBPoints = routeB.points;
      _distanceBKm = routeB.distance / 1000;
      _durationBMin = routeB.duration / 60;

      if (routeA != null && routeA.points.isNotEmpty) {
        _routeAPoints = routeA.points;
        _distanceAKm = routeA.distance / 1000;
        _durationAMin = routeA.duration / 60;
      }

      _loading = false;
    });

    // 6. Snackbar si no pudimos obtener ubicación del conductor
    if (_showDriverLocationWarning && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No pudimos obtener tu ubicación. La ruta hasta el pasajero no se muestra.',
          ),
        ),
      );
    }
  }

  /// Wrapper que ejecuta `getRoutePreview` con try/catch y convierte
  /// `gm.LatLng` → `latlong2.LatLng` para flutter_map.
  Future<({List<LatLng> points, double distance, double duration})?>
      _safeRoute(
    SearchBloc bloc,
    gm.LatLng start,
    gm.LatLng end,
    String label,
  ) async {
    try {
      final result = await bloc.getRoutePreview(start, end);
      debugPrint('TripPreviewSheet: ruta $label devolvió '
          '${result.points.length} puntos, dist=${result.distance}m');
      final converted = result.points
          .map((p) => LatLng(p.latitude, p.longitude))
          .toList();
      return (
        points: converted,
        distance: result.distance,
        duration: result.duration,
      );
    } catch (e) {
      debugPrint('TripPreviewSheet: ruta $label falló: $e');
      return null;
    }
  }
```

- [ ] **Step 3: Agregar import faltante si no está**

Verificar que en la parte superior del archivo aparecen estos imports (algunos ya están):

```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gm;
import 'package:latlong2/latlong.dart';
import 'package:tukytuk/blocs/search/search_bloc.dart';
import 'package:tukytuk/models/trip.dart';
```

- [ ] **Step 4: Validar compilación parcial**

Ejecutar:

```bash
cd tukytuk && flutter analyze lib/widgets/trip_preview_sheet.dart
```

Esperado: sin nuevos errores. Es OK que las advertencias mencionen campos no usados todavía (los consumirán Task 2 y 3).

- [ ] **Step 5: Commit**

```bash
cd tukytuk && git add lib/widgets/trip_preview_sheet.dart
git commit -m "refactor(trip-preview): estado y carga paralela de doble ruta

- Agrega ubicación del conductor vía Geolocator (con fallback).
- Lanza rutas A (conductor→recogida) y B (viaje) en paralelo
  con try/catch individual.
- debugPrint para diagnosticar bug de polyline invisible."
```

---

### Task 2: Renderizar ambas polylines y tres markers en `_buildMap`

**Files:**
- Modify: `tukytuk/lib/widgets/trip_preview_sheet.dart` (método `_buildMap`)

**Interfaces:**
- Consumes (de Task 1): `_failed`, `_failureMessage`, `_routeBPoints`, `_routeAPoints`, `_driverPos`, `_pickup`, `_destination`.
- Produces: nada — UI puramente.

- [ ] **Step 1: Reemplazar `_buildMap` completo**

Reemplazar el método `_buildMap()` actual (líneas ~119-164 originales) por:

```dart
  Widget _buildMap() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_failed || _routeBPoints.length < 2) {
      return Center(child: Text(_failureMessage));
    }

    // Unión de todos los puntos para encuadrar la cámara
    final allPoints = <LatLng>[
      ..._routeAPoints,
      ..._routeBPoints,
      if (_driverPos != null) _driverPos!,
      if (_pickup != null) _pickup!,
      if (_destination != null) _destination!,
    ];

    final polylines = <Polyline>[
      // Ruta B (viaje) — azul
      Polyline(
        points: _routeBPoints,
        strokeWidth: 6,
        color: Colors.blue,
      ),
      // Ruta A (conductor → recogida) — naranja, solo si existe
      if (_routeAPoints.length >= 2)
        Polyline(
          points: _routeAPoints,
          strokeWidth: 6,
          color: Colors.orange,
        ),
    ];

    final markers = <Marker>[
      // Conductor (verde)
      if (_driverPos != null)
        Marker(
          point: _driverPos!,
          width: 36,
          height: 36,
          child: const Icon(
            Icons.directions_car,
            color: Colors.green,
            size: 32,
          ),
        ),
      // Recogida (naranja)
      if (_pickup != null)
        Marker(
          point: _pickup!,
          width: 32,
          height: 32,
          child: const Icon(
            Icons.my_location,
            color: Colors.orange,
            size: 28,
          ),
        ),
      // Destino (rojo)
      if (_destination != null)
        Marker(
          point: _destination!,
          width: 32,
          height: 32,
          child: const Icon(
            Icons.location_on,
            color: Colors.red,
            size: 28,
          ),
        ),
    ];

    return FlutterMap(
      options: MapOptions(
        initialCameraFit: CameraFit.bounds(
          bounds: LatLngBounds.fromPoints(allPoints),
          padding: const EdgeInsets.all(48),
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.tukytuk.app',
        ),
        PolylineLayer(polylines: polylines),
        MarkerLayer(markers: markers),
      ],
    );
  }
```

- [ ] **Step 2: Verificar compilación**

Ejecutar:

```bash
cd tukytuk && flutter analyze lib/widgets/trip_preview_sheet.dart
```

Esperado: sin errores. `_distanceAKm`, `_durationAMin`, `_distanceBKm`, `_durationBMin` aún sin consumir → Task 3.

- [ ] **Step 3: Commit**

```bash
cd tukytuk && git add lib/widgets/trip_preview_sheet.dart
git commit -m "feat(trip-preview): dibuja ambas rutas y 3 markers en el mapa

- Polyline azul: viaje (recogida→destino).
- Polyline naranja: conductor→recogida (si disponible).
- Markers: conductor (auto verde), recogida (naranja),
  destino (rojo). Cámara ajusta a la unión de ambas rutas."
```

---

### Task 3: Métricas en dos columnas en `_buildMetrics`

**Files:**
- Modify: `tukytuk/lib/widgets/trip_preview_sheet.dart` (método `_buildMetrics`)

**Interfaces:**
- Consumes (de Task 1): `_distanceAKm`, `_durationAMin`, `_distanceBKm`, `_durationBMin`.

- [ ] **Step 1: Reemplazar `_buildMetrics` completo**

Reemplazar el método `_buildMetrics()` actual por:

```dart
  Widget _buildMetrics() {
    String fmtKm(double? v) =>
        v == null ? '—' : '${v.toStringAsFixed(1)} km';
    String fmtMin(double? v) =>
        v == null ? '—' : '${v.toStringAsFixed(0)} min';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _metricColumn(
            label: 'Hasta el pasajero',
            distance: fmtKm(_distanceAKm),
            duration: fmtMin(_durationAMin),
            color: Colors.orange,
          ),
          _metricColumn(
            label: 'Viaje',
            distance: fmtKm(_distanceBKm),
            duration: fmtMin(_durationBMin),
            color: Colors.blue,
          ),
        ],
      ),
    );
  }

  Widget _metricColumn({
    required String label,
    required String distance,
    required String duration,
    required Color color,
  }) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(color: color, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(distance, style: const TextStyle(fontWeight: FontWeight.bold)),
        Text(duration, style: const TextStyle(color: Colors.black54)),
      ],
    );
  }
```

- [ ] **Step 2: Verificar compilación final**

Ejecutar:

```bash
cd tukytuk && flutter analyze lib/widgets/trip_preview_sheet.dart
```

Esperado: cero errores y cero warnings nuevos.

- [ ] **Step 3: Commit**

```bash
cd tukytuk && git add lib/widgets/trip_preview_sheet.dart
git commit -m "feat(trip-preview): métricas en dos columnas (pasajero + viaje)

Cada columna usa el color de su polyline correspondiente para
asociación visual rápida."
```

---

### Task 4: Verificación end-to-end en dispositivo

**Files:** ninguno — verificación manual.

**Interfaces:** valida que todo el flujo del conductor funcione.

- [ ] **Step 1: `flutter analyze` global**

```bash
cd tukytuk && flutter analyze
```

Esperado: sin nuevos errores ni warnings. Si aparecen, arreglarlos.

- [ ] **Step 2: Compilar y correr en dispositivo físico**

```bash
cd tukytuk && flutter run -d R5CT63D67ZM
```

Si falla con `Gradle task assembleDebug failed with exit code 1`:
- Ejecutar `cd android && ./gradlew --stop` y reintentar (causa documentada: daemons stale con JVMs distintas).

- [ ] **Step 3: Probar el flujo conductor**

Como conductor (cuenta tipo driver), con la suscripción activa:

1. Activar el switch "online" en `TripDriverPage`.
2. Asegurar que hay al menos un viaje en estado `S` (solicitado) — crear uno desde otra cuenta pasajero si es necesario.
3. Tocar "Ver ruta" en una tarjeta de viaje.
4. **Verificar visualmente**:
   - Mapa OSM se carga.
   - Polyline **azul** entre recogida y destino visible.
   - Polyline **naranja** entre tu ubicación actual y la recogida visible.
   - Tres markers: 🟢 auto verde (tú), 🟠 my_location (recogida), 🔴 location_on (destino).
   - Columnas inferiores: "Hasta el pasajero" con km/min naranja, "Viaje" con km/min azul.
   - Cámara encuadra todo sin recortar.
5. **Probar fallback**: negar permisos GPS de la app (Ajustes Android) → reintentar "Ver ruta":
   - Snackbar "No pudimos obtener tu ubicación..."
   - Mapa muestra solo polyline azul, marker recogida + destino.
   - Columna "Hasta el pasajero" muestra "—".
6. **Probar Aceptar/Rechazar**: ambos botones deben seguir funcionando como antes (Aceptar navega a `loading_driver`, Rechazar cierra modal y refresca lista).

- [ ] **Step 4: Revisar logs**

En la consola de Flutter, confirmar que aparecen los `debugPrint`:

```
TripPreviewSheet: pickup=(...) destination=(...)
TripPreviewSheet: driver=(...)
TripPreviewSheet: ruta A devolvió N puntos, dist=...
TripPreviewSheet: ruta B devolvió M puntos, dist=...
```

Si ruta B devuelve **0 puntos** o la polyline azul sigue invisible: el bug original tenía otra causa raíz; reportarlo con el dump de coords y `M` para investigar Mapbox.

- [ ] **Step 5: Commit final (si hubo ajustes en Step 1)**

Si `flutter analyze` requirió ajustes:

```bash
cd tukytuk && git add lib/widgets/trip_preview_sheet.dart
git commit -m "fix(trip-preview): resolver warnings de análisis"
```

Si no, no se requiere commit adicional en esta task.
