# Vista previa de viaje del conductor con doble ruta

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Flutter app — modal `TripPreviewSheet` antes de aceptar/rechazar viaje

## Problema

Cuando el conductor abre el modal "Ver ruta" desde la lista de viajes solicitados, se observan dos problemas:

1. **No se ve la polyline del viaje del pasajero**: el mapa carga (tiles OSM visibles) pero la línea entre origen y destino no aparece. Causa probable: geometría vacía, viaje muy corto, o falla silenciosa en `_loadRoute` que no se refleja en UI.
2. **Falta la ruta del conductor al punto de recogida**: el conductor necesita ver visualmente cuánto debe recorrer hasta llegar al pasajero antes de decidir aceptar.

Estos dos puntos bloquean la decisión informada de aceptar/rechazar un viaje.

## Solución

Refactorizar `lib/widgets/trip_preview_sheet.dart` para mostrar **dos rutas simultáneamente** en el mismo `FlutterMap`:

- **Ruta A — naranja**: conductor → punto de recogida del pasajero
- **Ruta B — azul**: punto de recogida → destino del pasajero (la actual)

Adicionalmente, mejorar visibilidad de la polyline y endurecer el manejo de errores para que cualquier falla parcial sea visible al usuario en vez de silenciosa.

## Comportamiento detallado

### Carga inicial (`_loadRoute`)
1. Parsear `trip.startLat/startLng/endLat/endLng`. Si alguna es inválida → estado `_failed` con mensaje **"Coordenadas del viaje inválidas"**.
2. Obtener ubicación actual del conductor con `Geolocator.getCurrentPosition(LocationAccuracy.high)`. Guardar resultado o flag de fallo (no abortar).
3. Lanzar en paralelo (`Future.wait`):
   - Ruta A: `getRoutePreview(driverPos, pickup)` — solo si la ubicación del conductor se obtuvo.
   - Ruta B: `getRoutePreview(pickup, destination)`.
   Cada futuro envuelto en try/catch individual para que un fallo no tumbe al otro.
4. Guardar en estado: `_routeAPoints`, `_routeBPoints`, `_distanceAKm/_durationAMin`, `_distanceBKm/_durationBMin`, `_driverPos`.

### Render (`_buildMap`)
- Si **ruta B falló** (la principal): mostrar texto "No se pudo cargar la ruta del viaje" (igual que hoy).
- Si **ruta B OK**: renderizar `FlutterMap` con:
  - `TileLayer` OSM (sin cambio).
  - `PolylineLayer` con ambas polylines (la que existe):
    - Ruta A si está disponible: `color: Colors.orange, strokeWidth: 6`.
    - Ruta B: `color: Colors.blue, strokeWidth: 6` (antes era 4).
  - `MarkerLayer`:
    - 🟢 Conductor (`Icons.directions_car`, color verde) en `_driverPos` — si disponible.
    - 🟡 Recogida (`Icons.my_location`, color naranja) en `pickup`.
    - 🔴 Destino (`Icons.location_on`, color rojo) en `destination`.
  - `initialCameraFit: CameraFit.bounds(bounds: LatLngBounds.fromPoints(<union de A + B>), padding: 48)`.

### Render (`_buildMetrics`)
Dos columnas en lugar de una:

| Hasta el pasajero | Viaje |
|---|---|
| `_distanceAKm` km / `_durationAMin` min | `_distanceBKm` km / `_durationBMin` min |

Si la ruta A no está disponible (fallo de geolocalización o de Mapbox), su columna muestra "—".

### Manejo de errores resumido
| Caso | Comportamiento |
|---|---|
| Coords trip inválidas | Mensaje "Coordenadas del viaje inválidas", sin mapa. |
| Geolocator falla | Snackbar "No pudimos obtener tu ubicación" + render solo ruta B + marker pasajero/destino. |
| Mapbox falla ruta A | Solo dibuja ruta B + marker pickup/destination. |
| Mapbox falla ruta B | Mensaje "No se pudo cargar la ruta del viaje". |
| `_routePoints.length < 2` en ruta B | Mismo mensaje de fallo. |

### Diagnóstico del bug actual
Se añade `debugPrint` en `_loadRoute` que imprime:
- Coords parseadas (start/end).
- Longitud de `result.points` para cada ruta.
- Mensaje de error si lo hay.

`debugPrint` es no-op en release mode (Flutter lo descarta), por lo que se deja permanente. Ayudará a diagnosticar fallos futuros.

## Archivos a tocar

- `lib/widgets/trip_preview_sheet.dart` — único archivo modificado. Refactor del state y `_buildMap`/`_buildMetrics`.

No se tocan:
- Backend (`tukytukapi/`) — el endpoint de viajes ya devuelve start/end coords.
- `SearchBloc.getRoutePreview` — se reutiliza tal cual.
- `Trip` model — campos existentes son suficientes.

## Fuera de alcance

- Polling de la ruta tras abrir el modal (la ruta se calcula una vez).
- Tráfico en tiempo real / ETA dinámico.
- Cambios en `map_driver_screen.dart` (el mapa post-aceptación). Si el conductor también pierde la ruta tras aceptar, eso será otro spec.
- Cancelación de viaje por parte del conductor — fuera de este flujo.

## Criterio de aceptación

1. Al tocar "Ver ruta" sobre un viaje solicitado, el modal muestra mapa con **dos** polylines de colores distintos cuando la ubicación del conductor está disponible.
2. La métrica inferior muestra dos columnas con distancia/tiempo de cada tramo.
3. Si el conductor niega/falla la ubicación GPS, el modal sigue funcionando (degrada a una sola ruta + snackbar).
4. Si Mapbox falla para la ruta del viaje, se muestra el mensaje claro existente.
5. El bug de polyline invisible queda diagnosticado vía los logs temporales o resuelto al aumentar `strokeWidth`.
