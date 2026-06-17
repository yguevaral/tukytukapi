# Pasajero: TripCard unificado, viajes pasados colapsables, diálogos de confirmación

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Frontend Flutter (home pasajero, home conductor, map_screen) + un cambio backend (cancelar en estados A/P).

## Problema

La vista del pasajero tiene tres deudas de UX:

1. **Inconsistencia visual con el conductor.** El conductor con viaje activo ve un card prominente (`_driverActiveTripCard` en `home_page.dart`) con icono auto, estado, origen, destino y botón "Continuar viaje". El pasajero ve `_listRowHomeActivo` que es un `ListTile` plano con texto hardcoded ("Viaje con Yordi") y subtítulo genérico.
2. **Viajes pasados como lista plana.** `_listRowHome` muestra cada viaje completado como un `ListTile` siempre expandido — saturando la pantalla cuando hay varios.
3. **Acciones del pasajero sin confirmación.** Hoy:
   - Solicitar viaje se ejecuta directo (sin previa visual).
   - Cancelar en S tiene un dialog genérico sin info del viaje.
   - No existe forma de cancelar en A/P.
   - No existe confirmación de llegada al destino.

## Solución

Cinco cambios coordinados:

1. **Widget compartido `TripCard`** con dos variantes (`active` y `summary`) usado en todas las vistas — pasajero y conductor.
2. **Lista colapsable** para viajes pasados del pasajero (`ExpansionTile`).
3. **Cuatro diálogos de confirmación** con resumen del viaje vía `TripCard.summary`.
4. **Backend `cancelUserTrip`** acepta cancelación en S, A y P (antes solo S) + emite socket al conductor.
5. **Reemplazo del card actual del conductor** por el `TripCard.active` compartido para consistencia.

---

### 1. Widget compartido `TripCard`

**Archivo nuevo:** `tukytuk/lib/widgets/trip_card.dart`

Dos constructores estáticos:

```dart
class TripCard {
  // Card prominente — se muestra en home (pasajero o conductor) cuando hay viaje activo.
  factory TripCard.active({
    required Trip trip,
    required VoidCallback onContinue,
    String title = 'Viaje en curso',
    IconData icon = Icons.directions_car,
    String continueLabel = 'Continuar viaje',
  });

  // Versión compacta sin botón — se usa dentro de diálogos y como contenido
  // expandido en la lista de viajes pasados.
  factory TripCard.summary(Trip trip);
}
```

**Layout `active`:**

```
┌────────────────────────────────────────┐
│ 🚕 Viaje en curso                       │
│                                         │
│ Yendo a recoger al pasajero             │   ← estado en lenguaje natural
│                                         │
│ Origen: lat,lng                         │
│ Destino: lat,lng                        │
│                                         │
│ [ Continuar viaje ]                     │
└────────────────────────────────────────┘
```

Mismo styling que el `_driverActiveTripCard` actual: `Container` con `padding: 16`, `borderRadius: 12`, `BoxShadow` suave, ícono `primaryColorBlue`, botón `ElevatedButton.icon` con icono `Icons.navigation`.

**Layout `summary`:**

Versión compacta sin botón, sin icono grande, sin sombra dura — solo origen, destino y estado en una columna compacta para usar dentro de otro contenedor (dialog body, ExpansionTile child).

**Mapping `userStatus` → texto del subtítulo (en ambos modos):**

| userStatus | Texto |
|---|---|
| `S` | "Buscando conductor" |
| `A` | "Yendo a recoger al pasajero" |
| `P` | "En viaje" |
| `F` | "Viaje finalizado" |
| `C` | "Viaje cancelado" |
| otro | "Viaje en curso" |

### 2. `home_passanger_page.dart` — refactor

**Viaje activo (líneas 130-135 actuales):**

Reemplazar:
```dart
usuariosActivo.isNotEmpty ? Text('Viaje Activo', ...) : Text('Inicia tus viajes'),
usuariosActivo.isNotEmpty ? _headerListHomeActivo(usuariosActivo) : SizedBox(),
```

Por:
```dart
if (usuariosActivo.isNotEmpty)
  TripCard.active(
    trip: usuariosActivo.first,
    title: 'Tu viaje activo',
    onContinue: () { /* sync authService + Navigator.pushNamed('loading_gps') */ },
  )
else
  Text('Inicia tus viajes'),
```

Eliminar el helper `_listRowHomeActivo` (queda muerto).

**Viajes anteriores (líneas 136-142 actuales):**

Reemplazar `_headerListHome` por una lista de `ExpansionTile`:

```dart
if (usuarios.isNotEmpty) ...[
  Padding(
    padding: EdgeInsets.all(16),
    child: Text('Viajes anteriores', style: TextStyle(fontSize: 20)),
  ),
  ListView.builder(
    shrinkWrap: true,
    physics: NeverScrollableScrollPhysics(),
    itemCount: usuarios.length,
    itemBuilder: (_, i) => _PastTripTile(trip: usuarios[i]),
  ),
],
```

Donde `_PastTripTile` es un private widget en `home_passanger_page.dart` que renderiza:

```dart
ExpansionTile(
  leading: CircleAvatar(child: Icon(Icons.history)),
  title: Text(_formatDate(trip.createdAt)),   // ej: "12 de junio, 2026"
  subtitle: Text('Viaje finalizado'),
  children: [
    Padding(padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: TripCard.summary(trip)),
  ],
)
```

`_formatDate` usa `intl` (ya en pubspec via flutter_localizations) o un format simple ad-hoc: `${trip.createdAt?.day} de ${meses[trip.createdAt?.month-1]}, ${trip.createdAt?.year}` con un array hardcoded de meses en español.

Eliminar `_listRowHome` (queda muerto).

### 3. `home_page.dart` (conductor) — reemplazar card existente

Reemplazar el helper `_driverActiveTripCard` actual (creado en la sesión pasada) por una llamada a `TripCard.active`:

```dart
if (_driverActiveTrip != null)
  TripCard.active(
    trip: _driverActiveTrip!,
    title: 'Viaje en curso',
    onContinue: () => Navigator.pushNamed(context, 'loading_driver'),
  )
else ...[ /* lista disponible como hoy */ ]
```

Eliminar el método `_driverActiveTripCard`. El estado y la lógica de `_cargarUsuarios` no cambian.

### 4. Diálogos de confirmación

**Archivo nuevo:** `tukytuk/lib/helpers/trip_confirmation_dialog.dart`

Cuatro funciones que devuelven `Future<bool>` (`true` = confirmar, `false` o `null` = cancelar):

```dart
Future<bool> confirmRequestTrip(BuildContext context, {required Trip pendingTrip});
Future<bool> confirmCancelInSearching(BuildContext context, {required Trip trip});
Future<bool> confirmCancelDuringTrip(BuildContext context, {required Trip trip});
Future<bool> confirmArrival(BuildContext context, {required Trip trip});
```

Implementación común: `showDialog<bool>` con `AlertDialog`:

```
┌─────────────────────────────────────┐
│  Título del dialog                  │
│                                     │
│  [TripCard.summary del trip]        │
│                                     │
│  Texto explicativo de la acción     │
│                                     │
│      [Cancelar]      [Confirmar]    │
└─────────────────────────────────────┘
```

| Helper | Título | Texto explicativo | Color botón confirmar |
|---|---|---|---|
| `confirmRequestTrip` | "Solicitar viaje" | "Esto enviará tu solicitud a los conductores cercanos." | `primaryColorBlue` |
| `confirmCancelInSearching` | "Cancelar búsqueda" | "Aún no hay conductor asignado. Esto cancela tu solicitud sin cargos." | `Colors.red` |
| `confirmCancelDuringTrip` | "Cancelar viaje en curso" | "⚠️ Tu conductor ya fue asignado. Cancelar puede generar cargos." | `Colors.red` |
| `confirmArrival` | "¿Llegaste a tu destino?" | "Confirma que llegaste para finalizar este viaje." | `Colors.green` |

Los botones usan `TextButton` con texto "Cancelar" / `<acción>` (no fondo de color en TextButton — el color va al `foregroundColor`).

**Integración en `map_screen.dart`:**

1. **C1 — Solicitar viaje**: en el `GestureDetector.onTap` del botón principal cuando `userStatus` está vacío y `tripActivated` es `true` (rama `else` que llama `setUserTrip` actual). Construir un `Trip` temporal con `startLat/Lng` = ubicación actual y `endLat/Lng` = `authService.end!.lat/lng`. Pasarlo a `confirmRequestTrip`. Si `true`, proceder con el `setUserTrip` actual. Si `false`, no hacer nada.

2. **C2 — Cancelar en S**: reemplazar `_confirmAndCancelTrip` actual por `confirmCancelInSearching(context, trip: authService.trip!)` + el flujo de `cancelTrip` existente.

3. **C3 — Cancelar en A/P**: agregar un nuevo FAB `Cancelar viaje` que se muestra cuando `userStatus == 'A' || userStatus == 'P'`. Color rojo. Tap → `confirmCancelDuringTrip` → si `true`, llamar `TripService.cancelTrip(uid)` (mismo endpoint, ahora soporta A/P) → snackbar + navegar a home.

4. **C4 — Confirmar llegada (F)**: hoy cuando `userStatus == 'F'`, el tap del botón principal navega a `home_passanger`. Reemplazar por: `confirmArrival` → si `true`, navegar; si `false`, quedarse.

### 5. Backend — extender `cancelUserTrip`

`tukytukapi/controllers/trip.js` líneas 204-227:

**Antes (rechaza A y P):**
```js
if (trip.user_status !== 'S') {
    return res.status(409).json({
        ok: false,
        msg: 'Solo se puede cancelar mientras está solicitado'
    });
}
```

**Después:**
```js
if (!['S', 'A', 'P'].includes(trip.user_status)) {
    return res.status(409).json({
        ok: false,
        msg: 'Este viaje ya no se puede cancelar'
    });
}
const wasAssigned = trip.user_status === 'A' || trip.user_status === 'P';
trip.user_status = 'C';
trip.cancelledAt = new Date();
await trip.save();

// Si había conductor asignado, notificarle por socket para que su UI reaccione.
if (wasAssigned && trip.driver) {
    const { io } = require('../index');
    io.to(String(trip.driver)).emit('trip-status-changed', {
        user_status: 'C',
        driver_status: trip.driver_status,
    });
}

return res.status(200).json({ ok: true, msg: 'Trip cancelado', trip });
```

La app del conductor ya escucha `trip-status-changed` en `MapDriverScreen` y `map_screen.dart` (línea 79). Esta sesión NO modifica la UI del conductor para reaccionar; eso queda como otro spec si hace falta UX específica.

## Fuera de alcance

- Sistema de calificación / estrellas al conductor.
- Cálculo de costo estimado al solicitar (el diálogo dice "envía solicitud", no menciona precio).
- Reacción del conductor en su UI cuando le cancelan en A/P (el evento se emite, pero la respuesta visual del conductor es otro spec).
- Migración de `cancelledAt` a un enum más rico de motivos de cancelación.
- Reverse-geocoding de coords a direcciones legibles en `TripCard` (siguen como `lat, lng`).

## Criterio de aceptación

1. Pasajero con viaje activo en home: ve el TripCard prominente (mismo estilo que el conductor) con botón "Continuar viaje" que navega a `loading_gps`.
2. Pasajero con viajes pasados: cada uno aparece como `ExpansionTile` colapsado por defecto, mostrando solo fecha + "Viaje finalizado". Al expandir, muestra `TripCard.summary` con detalles.
3. Conductor: ve el mismo TripCard que antes pero ahora viene del widget compartido (sin regresión visual).
4. Pasajero solicita viaje: ve dialog con resumen y botones Cancelar/Confirmar antes de que el request se envíe.
5. Pasajero cancela en S: ve dialog con resumen del viaje (no genérico).
6. Pasajero cancela en A o P: el FAB rojo "Cancelar viaje" está disponible. Tap → dialog con advertencia. Confirmar llama al backend, el viaje pasa a estado C, snackbar y vuelve a home.
7. Pasajero en estado F: ve dialog "¿Llegaste?" antes de volver a home.
8. Backend: `PUT /trip/user/cancelTrip` acepta trips en S, A, P y devuelve `ok: true`. Para A/P emite `trip-status-changed` al conductor vía socket.
