# Pasajero TripCard + confirmaciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el look de "viaje activo" entre pasajero y conductor con un `TripCard` compartido, hacer colapsables los viajes pasados del pasajero, agregar 4 diálogos de confirmación con resumen del viaje, y extender el backend para aceptar cancelación en estados A y P.

**Architecture:** Un widget compartido `TripCard` con constructores `active` y `summary` reemplaza el card del conductor existente y se reusa en home_passanger y dentro de los diálogos. Un nuevo archivo `trip_confirmation_dialog.dart` agrupa 4 helpers que muestran `AlertDialog` con `TripCard.summary` en el body. El backend `cancelUserTrip` se extiende para aceptar S/A/P y emitir socket al conductor cuando aplica.

**Tech Stack:** Flutter, `provider`, `flutter_bloc`, `google_maps_flutter`; Node.js + Express + Mongoose; Socket.IO.

## Global Constraints

- Idioma: TODO en español — UI, comentarios, mensajes, commits.
- Subproyectos son repos git independientes (`tukytuk/` y `tukytukapi/`). Cada commit dentro del subproyecto correspondiente.
- Backend NO tiene tests automatizados. Verificación: `node -e "require('./controllers/trip.js')"`.
- Frontend: `flutter analyze` debe pasar sin nuevos errores ni warnings nuevos por cada Task.
- Mapping `userStatus` → texto: `S`=Buscando conductor, `A`=Yendo a recoger al pasajero, `P`=En viaje, `F`=Viaje finalizado, `C`=Viaje cancelado, otro=Viaje en curso.
- Spec de referencia: `tukytukapi/docs/superpowers/specs/2026-06-17-pasajero-tripcard-confirmaciones-design.md`.

---

### Task 1: Backend — extender `cancelUserTrip` para aceptar S/A/P

**Files:**
- Modify: `tukytukapi/controllers/trip.js`

**Interfaces:**
- Produces:
  - `PUT /trip/user/cancelTrip` ahora retorna `200 ok` para trips en estado `S`, `A` o `P`.
  - Cuando el estado previo era A o P, emite por socket `trip-status-changed` a la room del `trip.driver` con `{user_status: 'C', driver_status: <actual>}`.

- [ ] **Step 1: Reemplazar el guard de status y agregar emisión de socket**

Abrir `tukytukapi/controllers/trip.js`. Localizar `cancelUserTrip` (aprox. línea 204). El estado actual es:

```js
const cancelUserTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        if (String(trip.usuario) !== String(req.uid)) {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }
        if (trip.user_status !== 'S') {
            return res.status(409).json({
                ok: false,
                msg: 'Solo se puede cancelar mientras está solicitado'
            });
        }
        trip.user_status = 'C';
        trip.cancelledAt = new Date();
        await trip.save();
        return res.status(200).json({ ok: true, msg: 'Trip cancelado', trip });
    } catch (err) {
        console.error('cancelUserTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

Reemplazar por:

```js
const cancelUserTrip = async (req, res = response) => {
    try {
        const trip = await Trip.findOne({ _id: req.body.uid_trip });
        if (!trip) {
            return res.status(404).json({ ok: false, msg: 'Trip no encontrado' });
        }
        if (String(trip.usuario) !== String(req.uid)) {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }
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

        // Si había conductor asignado, notificarle por socket para que su UI
        // reaccione (la app del conductor ya escucha 'trip-status-changed').
        if (wasAssigned && trip.driver) {
            const { io } = require('../index');
            io.to(String(trip.driver)).emit('trip-status-changed', {
                user_status: 'C',
                driver_status: trip.driver_status,
            });
        }

        return res.status(200).json({ ok: true, msg: 'Trip cancelado', trip });
    } catch (err) {
        console.error('cancelUserTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
};
```

- [ ] **Step 2: Verificar sintaxis del módulo**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
node -e "require('./controllers/trip.js'); console.log('OK')"
```

Esperado: imprime `OK`.

- [ ] **Step 3: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
git add controllers/trip.js
git commit -m "feat(trip): cancelUserTrip acepta cancelación en S, A y P

Antes solo permitía cancelar en estado S. Ahora el pasajero puede
también cancelar después de que el conductor aceptó (A) o ya está
en progreso (P). En esos casos emite trip-status-changed por socket
a la room del conductor para que su UI reaccione."
```

---

### Task 2: Widget compartido `TripCard`

**Files:**
- Create: `tukytuk/lib/widgets/trip_card.dart`

**Interfaces:**
- Produces:
  - `TripCard.active({required Trip trip, required VoidCallback onContinue, String title, IconData icon, String continueLabel})` — devuelve un `Widget` que renderiza el card prominente.
  - `TripCard.summary({required Trip trip})` — devuelve un `Widget` compacto sin botón.

- [ ] **Step 1: Crear el archivo con ambos constructores**

Crear `tukytuk/lib/widgets/trip_card.dart` con este contenido COMPLETO:

```dart
import 'package:flutter/material.dart';
import 'package:tukytuk/const/general.dart';
import 'package:tukytuk/models/trip.dart';

/// Tarjeta reutilizable para mostrar un viaje. Dos variantes:
///   - [TripCard.active]: card prominente con botón de acción. Se muestra en
///     home (pasajero o conductor) cuando hay viaje activo.
///   - [TripCard.summary]: card compacto sin botón. Se usa dentro de diálogos
///     y como contenido expandido de viajes pasados.
class TripCard extends StatelessWidget {
  final Trip trip;
  final VoidCallback? onContinue;
  final String title;
  final IconData icon;
  final String continueLabel;
  final bool _isActive;

  const TripCard._({
    required this.trip,
    required this.onContinue,
    required this.title,
    required this.icon,
    required this.continueLabel,
    required bool isActive,
  }) : _isActive = isActive;

  factory TripCard.active({
    Key? key,
    required Trip trip,
    required VoidCallback onContinue,
    String title = 'Viaje en curso',
    IconData icon = Icons.directions_car,
    String continueLabel = 'Continuar viaje',
  }) {
    return TripCard._(
      trip: trip,
      onContinue: onContinue,
      title: title,
      icon: icon,
      continueLabel: continueLabel,
      isActive: true,
    );
  }

  factory TripCard.summary({Key? key, required Trip trip}) {
    return TripCard._(
      trip: trip,
      onContinue: null,
      title: '',
      icon: Icons.directions_car,
      continueLabel: '',
      isActive: false,
    );
  }

  /// Convierte el userStatus del trip a texto en español.
  String get _statusLabel {
    switch (trip.userStatus) {
      case 'S':
        return 'Buscando conductor';
      case 'A':
        return 'Yendo a recoger al pasajero';
      case 'P':
        return 'En viaje';
      case 'F':
        return 'Viaje finalizado';
      case 'C':
        return 'Viaje cancelado';
      default:
        return 'Viaje en curso';
    }
  }

  String get _origen => '${trip.startLat ?? '-'}, ${trip.startLng ?? '-'}';
  String get _destino => '${trip.endLat ?? '-'}, ${trip.endLng ?? '-'}';

  @override
  Widget build(BuildContext context) {
    if (_isActive) {
      return _buildActive(context);
    }
    return _buildSummary(context);
  }

  Widget _buildActive(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 8,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: primaryColorBlue, size: 28),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            _statusLabel,
            style: const TextStyle(fontSize: 16, color: Colors.black87),
          ),
          const SizedBox(height: 12),
          Text('Origen: $_origen',
              style: const TextStyle(fontSize: 13, color: Colors.black54)),
          const SizedBox(height: 4),
          Text('Destino: $_destino',
              style: const TextStyle(fontSize: 13, color: Colors.black54)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              icon: const Icon(Icons.navigation),
              label: Text(continueLabel),
              style: ElevatedButton.styleFrom(
                backgroundColor: primaryColorBlue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onPressed: onContinue,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummary(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            _statusLabel,
            style: const TextStyle(
                fontSize: 14, fontWeight: FontWeight.w600, color: Colors.black87),
          ),
          const SizedBox(height: 6),
          Text('Origen: $_origen',
              style: const TextStyle(fontSize: 12, color: Colors.black54)),
          const SizedBox(height: 2),
          Text('Destino: $_destino',
              style: const TextStyle(fontSize: 12, color: Colors.black54)),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/widgets/trip_card.dart
```

Esperado: 0 errores, 0 warnings.

- [ ] **Step 3: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/widgets/trip_card.dart
git commit -m "feat(widgets): TripCard compartido con variantes active y summary

- TripCard.active: card prominente con icono, título, estado, origen,
  destino y botón de acción configurable. Sustituye el actual
  _driverActiveTripCard de home conductor y reemplaza el ListTile
  plano del pasajero (próximos tasks).
- TripCard.summary: variante compacta sin botón, para usar dentro
  de AlertDialog y como contenido expandido en ExpansionTile."
```

---

### Task 3: Helpers de diálogos de confirmación

**Files:**
- Create: `tukytuk/lib/helpers/trip_confirmation_dialog.dart`

**Interfaces:**
- Consumes (de Task 2): `TripCard.summary({required Trip trip})`.
- Produces:
  - `Future<bool> confirmRequestTrip(BuildContext, {required Trip pendingTrip})`
  - `Future<bool> confirmCancelInSearching(BuildContext, {required Trip trip})`
  - `Future<bool> confirmCancelDuringTrip(BuildContext, {required Trip trip})`
  - `Future<bool> confirmArrival(BuildContext, {required Trip trip})`

Cada función devuelve `true` si el usuario confirma, `false` si cancela o cierra el dialog.

- [ ] **Step 1: Crear el archivo con los 4 helpers**

Crear `tukytuk/lib/helpers/trip_confirmation_dialog.dart` con este contenido COMPLETO:

```dart
import 'package:flutter/material.dart';
import 'package:tukytuk/const/general.dart';
import 'package:tukytuk/models/trip.dart';
import 'package:tukytuk/widgets/trip_card.dart';

/// Muestra un AlertDialog reutilizable con TripCard.summary en el body.
/// Devuelve true si el usuario confirma, false en cualquier otro caso.
Future<bool> _showTripConfirmation(
  BuildContext context, {
  required String title,
  required Trip trip,
  required String description,
  required String confirmLabel,
  required Color confirmColor,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TripCard.summary(trip: trip),
          const SizedBox(height: 12),
          Text(description, style: const TextStyle(fontSize: 13)),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancelar'),
        ),
        TextButton(
          style: TextButton.styleFrom(foregroundColor: confirmColor),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result == true;
}

/// C1: confirmar antes de enviar la solicitud de viaje al backend.
Future<bool> confirmRequestTrip(
  BuildContext context, {
  required Trip pendingTrip,
}) {
  return _showTripConfirmation(
    context,
    title: 'Solicitar viaje',
    trip: pendingTrip,
    description: 'Esto enviará tu solicitud a los conductores cercanos.',
    confirmLabel: 'Solicitar',
    confirmColor: primaryColorBlue,
  );
}

/// C2: confirmar cancelación cuando el viaje aún está en S (sin conductor).
Future<bool> confirmCancelInSearching(
  BuildContext context, {
  required Trip trip,
}) {
  return _showTripConfirmation(
    context,
    title: 'Cancelar búsqueda',
    trip: trip,
    description:
        'Aún no hay conductor asignado. Esto cancela tu solicitud sin cargos.',
    confirmLabel: 'Sí, cancelar',
    confirmColor: Colors.red,
  );
}

/// C3: confirmar cancelación en A/P — incluye advertencia de cargo.
Future<bool> confirmCancelDuringTrip(
  BuildContext context, {
  required Trip trip,
}) {
  return _showTripConfirmation(
    context,
    title: 'Cancelar viaje en curso',
    trip: trip,
    description:
        '⚠️ Tu conductor ya fue asignado. Cancelar puede generar cargos.',
    confirmLabel: 'Sí, cancelar',
    confirmColor: Colors.red,
  );
}

/// C4: confirmar llegada al destino cuando el status pasa a F.
Future<bool> confirmArrival(
  BuildContext context, {
  required Trip trip,
}) {
  return _showTripConfirmation(
    context,
    title: '¿Llegaste a tu destino?',
    trip: trip,
    description: 'Confirma que llegaste para finalizar este viaje.',
    confirmLabel: 'Sí, finalizar',
    confirmColor: Colors.green,
  );
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/helpers/trip_confirmation_dialog.dart
```

Esperado: 0 errores, 0 warnings.

- [ ] **Step 3: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/helpers/trip_confirmation_dialog.dart
git commit -m "feat(helpers): 4 diálogos de confirmación con TripCard.summary

confirmRequestTrip, confirmCancelInSearching, confirmCancelDuringTrip
y confirmArrival reutilizan _showTripConfirmation internamente.
Cada uno define título, descripción y color del botón de confirmar."
```

---

### Task 4: `home_passanger_page.dart` — TripCard activo + viajes anteriores colapsables

**Files:**
- Modify: `tukytuk/lib/pages/home_passanger_page.dart`

**Interfaces:**
- Consumes (de Task 2): `TripCard.active(...)`, `TripCard.summary(trip:)`.

- [ ] **Step 1: Imports**

Al inicio del archivo, agregar:

```dart
import 'package:tukytuk/widgets/trip_card.dart';
```

- [ ] **Step 2: Reemplazar el bloque de render del viaje activo y los viajes anteriores**

Localizar dentro del `Column` del `body` (líneas ~130-142 actuales):

```dart
                    usuariosActivo.isNotEmpty
                        ? Text('Viaje Activo', style: TextStyle(fontSize: 20))
                        : Text('Inicia tus viajes'),
                    usuariosActivo.isNotEmpty
                        ? _headerListHomeActivo(usuariosActivo)
                        : SizedBox(),
                    usuarios.isNotEmpty
                        ? Text('Viaje Anteriores',
                            style: TextStyle(fontSize: 20))
                        : SizedBox(),
                    usuarios.isNotEmpty
                        ? _headerListHome(usuarios)
                        : SizedBox(),
```

Reemplazar por:

```dart
                    if (usuariosActivo.isNotEmpty)
                      TripCard.active(
                        trip: usuariosActivo.first,
                        title: 'Tu viaje activo',
                        onContinue: () {
                          final authService = Provider.of<AuthService>(
                              context, listen: false);
                          authService.setTrip(usuariosActivo.first);
                          authService.setTripActivated(true);
                          authService.setUserStatus(
                              usuariosActivo.first.userStatus ?? '');
                          Navigator.pushNamed(context, 'loading_gps');
                        },
                      )
                    else
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('Inicia tus viajes',
                            style: TextStyle(fontSize: 18)),
                      ),
                    if (usuarios.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text('Viajes anteriores',
                              style: TextStyle(
                                  fontSize: 20, fontWeight: FontWeight.bold)),
                        ),
                      ),
                      ListView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: usuarios.length,
                        itemBuilder: (_, i) => _PastTripTile(trip: usuarios[i]),
                      ),
                    ],
```

- [ ] **Step 3: Eliminar helpers viejos**

Eliminar los métodos `_headerListHomeActivo`, `_listRowHomeActivo`, `_headerListHome`, `_listRowHome` y `openSteetMapTileLayer` (este último era no usado o quedará no usado).

(El método `_cargarUsuarios` permanece sin cambios.)

- [ ] **Step 4: Agregar widget privado `_PastTripTile`**

Al final del archivo, ANTES del `}` que cierra la clase `_HomePassangerPageState`, agregar el nuevo widget como clase separada DESPUÉS del cierre de `_HomePassangerPageState`:

```dart
/// Item colapsable de viaje pasado. Por defecto colapsado: muestra solo fecha.
/// Al expandir, revela el TripCard.summary con detalles.
class _PastTripTile extends StatelessWidget {
  final Trip trip;
  const _PastTripTile({required this.trip});

  static const _meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  String _formatDate(DateTime? d) {
    if (d == null) return 'Fecha desconocida';
    return '${d.day} de ${_meses[d.month - 1]}, ${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const CircleAvatar(child: Icon(Icons.history)),
      title: Text(_formatDate(trip.createdAt)),
      subtitle: const Text('Viaje finalizado'),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: TripCard.summary(trip: trip),
        ),
      ],
    );
  }
}
```

- [ ] **Step 5: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/pages/home_passanger_page.dart
```

Esperado: 0 errores. Pueden quedar warnings de imports no usados de los helpers eliminados — quitar esos imports también si flutter_map o pull_to_refresh no se siguen usando (revisar).

- [ ] **Step 6: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/pages/home_passanger_page.dart
git commit -m "feat(home-passanger): usa TripCard.active y ExpansionTile para pasados

- Viaje activo: TripCard.active prominente (mismo look que conductor)
  con botón \"Continuar viaje\" que sincroniza AuthService y navega.
- Viajes anteriores: cada uno en ExpansionTile colapsado por defecto.
  Al expandir muestra TripCard.summary con origen/destino/estado.
- Helpers viejos (_listRowHome, _listRowHomeActivo,
  _headerListHome, _headerListHomeActivo) eliminados."
```

---

### Task 5: `home_page.dart` (conductor) — reemplazar `_driverActiveTripCard` por `TripCard.active`

**Files:**
- Modify: `tukytuk/lib/pages/home_page.dart`

**Interfaces:**
- Consumes (de Task 2): `TripCard.active(...)`.

- [ ] **Step 1: Imports**

Agregar al inicio del archivo:

```dart
import 'package:tukytuk/widgets/trip_card.dart';
```

- [ ] **Step 2: Reemplazar la llamada `_driverActiveTripCard(_driverActiveTrip!)` por `TripCard.active`**

Buscar en el render donde aparece `_driverActiveTripCard(_driverActiveTrip!)` (creado en sesión previa). Reemplazar EXACTAMENTE esa línea por:

```dart
                            TripCard.active(
                              trip: _driverActiveTrip!,
                              title: 'Viaje en curso',
                              onContinue: () =>
                                  Navigator.pushNamed(context, 'loading_driver'),
                            )
```

- [ ] **Step 3: Eliminar el helper `_driverActiveTripCard`**

Buscar el método `Widget _driverActiveTripCard(Trip trip) { ... }` y eliminarlo completo. Ya no se usa.

- [ ] **Step 4: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/pages/home_page.dart
```

Esperado: 0 errores. Si el `import 'package:tukytuk/widgets/trip_card.dart';` agregado se reporta como no usado, hay un bug — revisar Step 2.

- [ ] **Step 5: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/pages/home_page.dart
git commit -m "refactor(home-conductor): usa TripCard.active compartido

Reemplaza el helper local _driverActiveTripCard (que será deduplicado
con el lado pasajero) por TripCard.active del widget compartido.
Mismo look visual, código centralizado."
```

---

### Task 6: `map_screen.dart` — integrar los 4 diálogos de confirmación + FAB cancelar A/P

**Files:**
- Modify: `tukytuk/lib/screens/map_screen.dart`

**Interfaces:**
- Consumes (de Task 3): `confirmRequestTrip`, `confirmCancelInSearching`, `confirmCancelDuringTrip`, `confirmArrival`.

- [ ] **Step 1: Imports**

Agregar al inicio del archivo:

```dart
import 'package:tukytuk/helpers/trip_confirmation_dialog.dart';
```

- [ ] **Step 2: Reemplazar `_confirmAndCancelTrip` para usar el nuevo helper**

Localizar el método `_confirmAndCancelTrip` (aprox. línea 312). Reemplazar el `showDialog<bool>(...)` actual con el helper:

```dart
  /// Muestra diálogo de confirmación y cancela el viaje si el usuario acepta.
  Future<void> _confirmAndCancelTrip(String uidTrip) async {
    final authService = context.read<AuthService>();
    final trip = authService.trip;
    if (trip == null) return;

    final confirmed = await confirmCancelInSearching(context, trip: trip);
    if (!mounted || !confirmed) return;

    final ok = await TripService().cancelTrip(uidTrip);
    if (!mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Viaje cancelado')),
      );
      Navigator.of(context).pushReplacementNamed('home_passanger');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo cancelar, intenta de nuevo')),
      );
    }
  }
```

- [ ] **Step 3: Agregar `_confirmAndCancelDuringTrip` para A/P**

Después del método `_confirmAndCancelTrip`, agregar:

```dart
  /// Cancela un viaje cuando ya está en estado A o P. El backend ahora lo
  /// permite y notifica al conductor por socket.
  Future<void> _confirmAndCancelDuringTrip(String uidTrip) async {
    final authService = context.read<AuthService>();
    final trip = authService.trip;
    if (trip == null) return;

    final confirmed = await confirmCancelDuringTrip(context, trip: trip);
    if (!mounted || !confirmed) return;

    final ok = await TripService().cancelTrip(uidTrip);
    if (!mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Viaje cancelado')),
      );
      Navigator.of(context).pushReplacementNamed('home_passanger');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo cancelar, intenta de nuevo')),
      );
    }
  }
```

- [ ] **Step 4: Mostrar el nuevo FAB de cancelar en A/P**

Localizar el bloque del FAB de cancelar en S (aprox. línea 242):

```dart
          // Botón cancelar: visible únicamente mientras se busca conductor
          if (authService.userStatus == 'S')
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FloatingActionButton.extended(
                heroTag: 'cancel-trip',
                backgroundColor: Colors.red,
                onPressed: () =>
                    _confirmAndCancelTrip(authService.trip!.uid ?? ''),
                icon: const Icon(Icons.close, color: Colors.white),
                label: const Text('Cancelar viaje',
                    style: TextStyle(color: Colors.white)),
              ),
            ),
```

Reemplazar por:

```dart
          // Botón cancelar — copy y handler difieren según el estado.
          if (authService.userStatus == 'S')
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FloatingActionButton.extended(
                heroTag: 'cancel-trip',
                backgroundColor: Colors.red,
                onPressed: () =>
                    _confirmAndCancelTrip(authService.trip!.uid ?? ''),
                icon: const Icon(Icons.close, color: Colors.white),
                label: const Text('Cancelar viaje',
                    style: TextStyle(color: Colors.white)),
              ),
            ),
          if (authService.userStatus == 'A' || authService.userStatus == 'P')
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FloatingActionButton.extended(
                heroTag: 'cancel-trip-during',
                backgroundColor: Colors.red,
                onPressed: () => _confirmAndCancelDuringTrip(
                    authService.trip!.uid ?? ''),
                icon: const Icon(Icons.close, color: Colors.white),
                label: const Text('Cancelar viaje',
                    style: TextStyle(color: Colors.white)),
              ),
            ),
```

- [ ] **Step 5: Confirmar antes de solicitar viaje (C1)**

Localizar el `GestureDetector` del botón principal (aprox. línea 489). Dentro del `onTap`, ubicar la rama `else` (cuando no hay viaje activo) que llama a `setUserTrip`:

```dart
                    } else {
                      final tripResponse = await tripService.setUserTrip(
                          locationBloc.state.lastKnownLocation!.latitude
                              .toString(),
                          locationBloc.state.lastKnownLocation!.longitude
                              .toString(),
                          authService.end!.latitude.toString(),
                          authService.end!.longitude.toString());

                      if (tripResponse?.uid != '') {
                        authService.setTrip(tripResponse!);
                      }
                      mapBloc.add( OnStartFollowingUserEvent() );
                      authService.setUserStatus('S');
                    }
```

Reemplazar por:

```dart
                    } else {
                      // C1: mostrar dialog con resumen antes de enviar el request.
                      final loc = locationBloc.state.lastKnownLocation!;
                      final end = authService.end!;
                      final pendingTrip = Trip(
                        userStatus: 'S',
                        startLat: loc.latitude.toString(),
                        startLng: loc.longitude.toString(),
                        endLat: end.latitude.toString(),
                        endLng: end.longitude.toString(),
                      );
                      final ok = await confirmRequestTrip(context,
                          pendingTrip: pendingTrip);
                      if (!mounted || !ok) return;

                      final tripResponse = await tripService.setUserTrip(
                          loc.latitude.toString(),
                          loc.longitude.toString(),
                          end.latitude.toString(),
                          end.longitude.toString());

                      if (tripResponse?.uid != '') {
                        authService.setTrip(tripResponse!);
                      }
                      mapBloc.add(OnStartFollowingUserEvent());
                      authService.setUserStatus('S');
                    }
```

Verificar que el archivo importa `Trip` desde `'package:tukytuk/models/trip.dart'`. Si no, agregar el import.

- [ ] **Step 6: Confirmar llegada en F (C4)**

Localizar la rama del `userStatus == 'F'`:

```dart
                    } else if (authService.userStatus == 'F') {
                      Navigator.pushReplacementNamed(context, 'home_passanger');
                    }
```

Reemplazar por:

```dart
                    } else if (authService.userStatus == 'F') {
                      final trip = authService.trip;
                      if (trip != null) {
                        final ok = await confirmArrival(context, trip: trip);
                        if (!mounted || !ok) return;
                      }
                      Navigator.pushReplacementNamed(context, 'home_passanger');
                    }
```

- [ ] **Step 7: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/screens/map_screen.dart
```

Esperado: 0 errores, ningún warning nuevo (los 3 pre-existentes pueden seguir).

- [ ] **Step 8: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_screen.dart
git commit -m "feat(map-screen): 4 diálogos de confirmación + FAB cancelar A/P

- C1 Solicitar viaje: dialog con resumen del trip pendiente.
- C2 Cancelar en S: dialog con TripCard.summary (antes era genérico).
- C3 Cancelar en A/P: nuevo FAB rojo con dialog que advierte de cargos.
  Reutiliza el endpoint cancelTrip (ahora soporta A/P en backend).
- C4 Confirmar llegada (F): dialog antes de volver a home_passanger."
```

---

### Task 7: Verificación end-to-end en dispositivo (manual)

**Files:** ninguno modificado — verificación.

**Interfaces:** valida la integración de TripCard, dialogs y backend.

- [ ] **Step 1: `flutter analyze` global**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze
```

Esperado: ningún issue nuevo respecto a la baseline pre-Task 1.

- [ ] **Step 2: Backend up**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
npm run start:dev
```

Esperado: arranca sin errores.

- [ ] **Step 3: App en dispositivo**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter run -d R5CT63D67ZM
```

Si falla con `Gradle task assembleDebug failed with exit code 1`: `cd android && ./gradlew --stop`, reintentar.

- [ ] **Step 4: Verificar home pasajero — viaje activo**

1. Loguearse como pasajero con un viaje en S, A o P.
2. En `home_passanger_page`: ver el `TripCard.active` prominente con icono auto azul, estado correcto ("Buscando conductor" / "Yendo a recoger al pasajero" / etc.), origen, destino y botón "Continuar viaje".
3. Tap "Continuar viaje" → navega a `loading_gps`.

- [ ] **Step 5: Verificar home pasajero — viajes anteriores colapsables**

1. Con un usuario que tenga viajes finalizados.
2. Ver "Viajes anteriores" como lista de `ExpansionTile` colapsados, mostrando solo fecha.
3. Tap en uno → expande mostrando `TripCard.summary` con origen/destino.
4. Tap de nuevo → colapsa.

- [ ] **Step 6: Verificar home conductor — sin regresión**

1. Loguearse como conductor con viaje activo (A o P).
2. Ver el mismo `TripCard.active` del refactor (debe lucir igual al de antes).

- [ ] **Step 7: Verificar diálogos de confirmación**

1. C1 Solicitar: tap del botón principal con destino seleccionado → dialog "Solicitar viaje" con resumen.
2. C2 Cancelar S: solicitar viaje, antes de que conductor acepte tap FAB "Cancelar viaje" → dialog "Cancelar búsqueda" con TripCard.
3. C3 Cancelar A/P: con conductor asignado, tap FAB rojo (debe existir) → dialog "Cancelar viaje en curso" con advertencia. Confirmar → trip pasa a C en backend, vuelve a home.
4. C4 Llegada F: simular llegada (driver finaliza desde MapDriverScreen) → tap del botón principal → dialog "¿Llegaste a tu destino?" → confirmar → home.

- [ ] **Step 8: Verificar backend cancel en A/P (curl o desde la app)**

Si se prefiere directo a curl:

```bash
TOKEN="<jwt_pasajero>"
TRIP_UID="<uid del trip en A o P>"
curl -X PUT http://localhost:3000/api/trip/user/cancelTrip \
  -H "x-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"uid_trip\":\"$TRIP_UID\"}"
```

Esperado: `{ ok: true, msg: "Trip cancelado", trip: {...user_status: "C"...} }`.

Si lo prueba la app del conductor (otro device): debería recibir `trip-status-changed` con `user_status: 'C'` y reaccionar (en esta sesión la reacción del conductor está fuera de alcance — solo verificar que el evento llega; puede agregarse un `debugPrint` puntual al listener `_statusSub` en `MapDriverScreen` para confirmarlo).

- [ ] **Step 9: Reportar resultados**

Si todo pasa, no se requiere commit adicional. Si hay ajustes menores, hacer commit aparte con mensaje descriptivo.
