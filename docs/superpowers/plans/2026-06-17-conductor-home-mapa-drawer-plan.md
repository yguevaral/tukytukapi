# Conductor home/drawer/mapa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres fixes coordinados en el flujo del conductor: home muestra viaje activo del conductor con card + botón "Continuar viaje" y oculta lista disponible; drawer respeta safe area inferior; `MapDriverScreen` dibuja la ruta también en estado P.

**Architecture:** Cambios distribuidos en 2 archivos backend (`tukytukapi/controllers/trip.js`) y 3 archivos frontend (`tukytuk/lib/services/trip_service.dart`, `tukytuk/lib/pages/home_page.dart`, `tukytuk/lib/widgets/drawer.dart`, `tukytuk/lib/screens/map_driver_screen.dart`). Cada fix es independiente: el backend agrega un endpoint funcional y un filtro defensivo; el frontend consume el endpoint en home y aplica fixes UI de bajo riesgo.

**Tech Stack:** Node + Express + Mongoose (backend); Flutter + http + provider + flutter_bloc (frontend).

## Global Constraints

- Idioma: TODO en español — UI, comentarios, mensajes, commits.
- Backend NO tiene tests automatizados (`npm test` placeholder). Verificación: cargar el módulo con `node -e` para detectar errores de sintaxis, después arrancar `npm run start:dev` y comprobar que sube sin errores.
- Frontend: `flutter analyze` debe pasar sin nuevos errores ni warnings nuevos por cada Task.
- Subproyectos son repos git independientes. Backend en `tukytukapi/`, frontend en `tukytuk/`. Cada commit se hace dentro del subproyecto correspondiente.
- Spec de referencia: `tukytukapi/docs/superpowers/specs/2026-06-17-conductor-home-mapa-drawer-design.md`.

---

### Task 1: Backend — arreglar `getDriverActiveTrip` y filtro defensivo en `getDriverListTrip`

**Files:**
- Modify: `tukytukapi/controllers/trip.js`

**Interfaces:**
- Produces:
  - Endpoint `GET /trip/driver/tripActive/:uid` (ya existe en routes, lo arreglamos) que retorna `{ ok, msg, trip, usuario }` con el trip activo del conductor (driver_status R o P) o `{ ok: false, trip: null }` si no hay.
  - `GET /trip/driver/listTrip` retorna `trips: []` si el conductor ya tiene viaje activo.

- [ ] **Step 1: Arreglar `getDriverActiveTrip`**

Abrir `tukytukapi/controllers/trip.js`. Localizar la función `getDriverActiveTrip` (aprox. línea 161). El estado actual es:

```js
const getDriverActiveTrip = async ( req, res = response ) => {

    const trip = await Trip.findOne({ $and: [{driver: req.uid, driver_status: ["R", "P"]}]});
    if ( !trip ) {
        return res.status(200).json({
            ok: false,
            msg: 'Trip no encontrado',
            trip: []
        });
    }    

    const usuario = await usuario.findOne({ $and: [{usuario: trip.usuario}]});

    res.json({
        ok: true,
        msg: 'Trip encontrado',
        trip,
        usuario
    });
}
```

Reemplazar por:

```js
const getDriverActiveTrip = async ( req, res = response ) => {
    try {
        // Query con $in — antes pasaba el array directo a driver_status, lo que en
        // Mongoose se interpreta como valor escalar y nunca matchea.
        const trip = await Trip.findOne({
            driver: req.uid,
            driver_status: { $in: ['R', 'P'] }
        });

        if ( !trip ) {
            return res.status(200).json({
                ok: false,
                msg: 'Trip no encontrado',
                trip: null
            });
        }

        // La variable se llamaba `usuario` igual que el modelo importado,
        // lo que producía un ReferenceError por shadowing en TDZ.
        const usuarioDoc = await usuario.findOne({ _id: trip.usuario });

        res.json({
            ok: true,
            msg: 'Trip encontrado',
            trip,
            usuario: usuarioDoc
        });
    } catch (err) {
        console.error('getDriverActiveTrip', { uid: req.uid, err: err.message });
        return res.status(500).json({ ok: false, msg: 'Error interno' });
    }
}
```

Notas:
- El import `const usuario = require('../models/usuario');` ya está en la línea 4 del archivo. No agregar otro import.
- `trip: null` (no array) — el cliente Flutter usa `tripResponseFromJson` que espera objeto o null.

- [ ] **Step 2: Filtro defensivo en `getDriverListTrip`**

Localizar `getDriverListTrip` (aprox. línea 82). Agregar al inicio del try/await, ANTES del `Trip.find(...)` existente:

```js
const getDriverListTrip = async ( req, res = response ) => {
    try {
        // Defense in depth: si el conductor ya tiene viaje activo (R o P),
        // no devolver viajes solicitados — la regla es 1 viaje activo por conductor.
        const activo = await Trip.findOne({
            driver: req.uid,
            driver_status: { $in: ['R', 'P'] }
        });
        if ( activo ) {
            return res.json({ ok: true, msg: 'Conductor con viaje activo', trips: [] });
        }

        // ... resto del query existente sin cambios
```

NO modificar el query existente de `Trip.find(...)`. Solo prepender el guard.

- [ ] **Step 3: Verificar que el módulo carga sin sintaxis rota**

Ejecutar:

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
node -e "require('./controllers/trip.js'); console.log('OK')"
```

Esperado: imprime `OK` sin lanzar excepción.

- [ ] **Step 4: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
git add controllers/trip.js
git commit -m "fix(trip): arreglar getDriverActiveTrip y filtrar lista para conductor con viaje activo

- getDriverActiveTrip: usar \$in en driver_status (antes pasaba array
  literal que Mongoose interpreta como escalar y nunca matchea) y
  renombrar variable usuario a usuarioDoc para evitar ReferenceError
  por shadowing del modelo importado.
- getDriverListTrip: prepender guard que retorna trips: [] si el
  conductor ya tiene viaje activo (driver_status R o P) — defense in
  depth de la regla un-viaje-por-conductor."
```

---

### Task 2: Frontend — `TripService.getDriverActiveTrip()` + lógica en home + card

**Files:**
- Modify: `tukytuk/lib/services/trip_service.dart`
- Modify: `tukytuk/lib/pages/home_page.dart`

**Interfaces:**
- Consumes (de Task 1): endpoint `GET /trip/driver/tripActive/:uid` retornando `{ ok, trip: Trip|null, usuario }`.
- Produces:
  - `TripService.getDriverActiveTrip() → Future<Trip?>` (null si no hay).
  - Render en `HomePage`: si `_driverActiveTrip != null`, muestra card con título "Viaje en curso", subtítulo de estado, origen/destino, botón "Continuar viaje". Oculta la sección "Viajes Disponibles".

- [ ] **Step 1: Agregar método al TripService**

Abrir `tukytuk/lib/services/trip_service.dart`. Localizar el método `getUserTripActive()` (aprox. línea 86). Justo DEBAJO de ese método agregar:

```dart
  Future<Trip?> getDriverActiveTrip() async {
    try {
      final resp = await http.get(
        Uri.parse('${Constants.apiUrl}/trip/driver/tripActive/x'),
        headers: {
          'Content-Type': 'application/json',
          'x-token': (await AuthService.getToken()) ?? ''
        },
      );

      final response = tripResponseFromJson(resp.body);
      // El backend devuelve { ok:false, trip:null } cuando no hay viaje activo.
      if (response.trip == null || (response.trip!.uid ?? '').isEmpty) return null;
      return response.trip;
    } catch (e) {
      return null;
    }
  }
```

Notas: el segmento `/x` al final de la URL es un dummy — el backend lo ignora (usa `req.uid` del JWT).

- [ ] **Step 2: Agregar campo de estado en HomePage**

Abrir `tukytuk/lib/pages/home_page.dart`. Localizar `_HomePassangerPageState` (sí, está mal nombrado — es el state del HomePage del conductor). Agregar entre los campos existentes (cerca de `List<Trip> usuarios = [];`, aprox. línea 40):

```dart
  /// Viaje activo del conductor (driver_status R o P). Null si no tiene viaje en curso.
  Trip? _driverActiveTrip;
```

- [ ] **Step 3: Modificar `_cargarUsuarios` para consultar viaje activo del conductor**

Localizar `_cargarUsuarios()` (aprox. línea 650). El estado actual termina así:

```dart
  _cargarUsuarios() async {

    usuariosActivo.clear();
    usuarios.clear();
    var usuariosT = await tripService.getUserTripActive();
    if (usuariosT?.uid != '') usuariosActivo.add(usuariosT!);

    var usuariosC = await tripService.getDriverListTrip();
    usuarios = usuariosC;

    var driverData = await tripService.getDriverActive();
    driverResponse = driverData;
    if (driverData != null) {
      driverVerification = driverData.driver?.status == 'A';
      driverVerificationStatus = driverData.driver?.status ?? '';
    } else {
      driverVerification = false;
      driverVerificationStatus = '';
    }
    
    setState(() {});
    refreshController.refreshCompleted();
  }
```

Modificarlo para que primero consulte el viaje activo del conductor, y si existe, omita la lista disponible y sincronice el AuthService:

```dart
  _cargarUsuarios() async {

    usuariosActivo.clear();
    usuarios.clear();

    // Viaje activo como conductor (driver_status R o P) tiene prioridad sobre todo.
    // Si existe, el conductor NO puede ver viajes disponibles — regla del negocio.
    final driverActive = await tripService.getDriverActiveTrip();
    _driverActiveTrip = driverActive;
    if (driverActive != null) {
      final authService = Provider.of<AuthService>(context, listen: false);
      authService.setTrip(driverActive);
      authService.setTripActivated(true);
      authService.setUserStatus(driverActive.userStatus ?? '');
    } else {
      // Sin viaje activo: comportamiento existente.
      var usuariosT = await tripService.getUserTripActive();
      if (usuariosT?.uid != '') usuariosActivo.add(usuariosT!);

      var usuariosC = await tripService.getDriverListTrip();
      usuarios = usuariosC;
    }

    var driverData = await tripService.getDriverActive();
    driverResponse = driverData;
    if (driverData != null) {
      driverVerification = driverData.driver?.status == 'A';
      driverVerificationStatus = driverData.driver?.status ?? '';
    } else {
      driverVerification = false;
      driverVerificationStatus = '';
    }

    if (!mounted) return;
    setState(() {});
    refreshController.refreshCompleted();
  }
```

- [ ] **Step 4: Render del card de viaje activo del conductor**

Localizar el render en `build` (aprox. línea 135-150). El estado actual es:

```dart
                    ? Column(
                        children: [
                          usuariosActivo.isNotEmpty
                              ? Text('Viaje Activo',
                                  style: TextStyle(fontSize: 20))
                              : SizedBox(),
                          usuariosActivo.isNotEmpty
                              ? _headerListHomeActivo(usuariosActivo)
                              : SizedBox(),
                          Text('Viajes Disponibles',
                              style: TextStyle(fontSize: 20)),
                          usuarios.isNotEmpty
                              ? _headerListHome(usuarios)
                              : Text('0', style: TextStyle(fontSize: 20)),
                        ],
                      )
```

Reemplazar por:

```dart
                    ? Column(
                        children: [
                          // Prioridad 1: el conductor tiene viaje en curso (R/P) →
                          // card destacado, sin lista disponible, sin sección pasajero.
                          if (_driverActiveTrip != null)
                            _driverActiveTripCard(_driverActiveTrip!)
                          else ...[
                            usuariosActivo.isNotEmpty
                                ? Text('Viaje Activo',
                                    style: TextStyle(fontSize: 20))
                                : SizedBox(),
                            usuariosActivo.isNotEmpty
                                ? _headerListHomeActivo(usuariosActivo)
                                : SizedBox(),
                            Text('Viajes Disponibles',
                                style: TextStyle(fontSize: 20)),
                            usuarios.isNotEmpty
                                ? _headerListHome(usuarios)
                                : Text('0', style: TextStyle(fontSize: 20)),
                          ],
                        ],
                      )
```

- [ ] **Step 5: Agregar el widget `_driverActiveTripCard`**

Localizar cualquier método helper privado de `_HomePassangerPageState` (por ejemplo `_listRowHomeActivo` aprox. línea 578). Agregar JUSTO ENCIMA de `_listRowHomeActivo` el nuevo método:

```dart
  /// Card grande que muestra el viaje en curso del conductor y permite
  /// volver al mapa con un tap. Solo se muestra cuando hay un trip con
  /// driver_status R o P según el backend.
  Widget _driverActiveTripCard(Trip trip) {
    final estado = trip.userStatus == 'A'
        ? 'Yendo a recoger al pasajero'
        : (trip.userStatus == 'P' ? 'En viaje' : 'Viaje en curso');

    final origen = '${trip.startLat ?? '-'}, ${trip.startLng ?? '-'}';
    final destino = '${trip.endLat ?? '-'}, ${trip.endLng ?? '-'}';

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
            children: const [
              Icon(Icons.directions_car, color: primaryColorBlue, size: 28),
              SizedBox(width: 8),
              Text(
                'Viaje en curso',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            estado,
            style: const TextStyle(fontSize: 16, color: Colors.black87),
          ),
          const SizedBox(height: 12),
          Text('Origen: $origen',
              style: const TextStyle(fontSize: 13, color: Colors.black54)),
          const SizedBox(height: 4),
          Text('Destino: $destino',
              style: const TextStyle(fontSize: 13, color: Colors.black54)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              icon: const Icon(Icons.navigation),
              label: const Text('Continuar viaje'),
              style: ElevatedButton.styleFrom(
                backgroundColor: primaryColorBlue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onPressed: () {
                Navigator.pushNamed(context, 'loading_driver');
              },
            ),
          ),
        ],
      ),
    );
  }
```

- [ ] **Step 6: Verificar compilación**

Ejecutar:

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/services/trip_service.dart lib/pages/home_page.dart
```

Esperado: 0 errores, 0 warnings NUEVOS (los pre-existentes en home_page como `prefer_const_constructors` siguen pero no son tuyos).

- [ ] **Step 7: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/services/trip_service.dart lib/pages/home_page.dart
git commit -m "feat(home): card de viaje activo del conductor; oculta lista disponible

- TripService.getDriverActiveTrip(): consume GET /trip/driver/tripActive
  para obtener el viaje en curso del conductor (driver_status R o P).
- HomePage._cargarUsuarios: si hay viaje activo, prioriza ese trip,
  sincroniza AuthService y limpia la lista disponible.
- Nuevo widget _driverActiveTripCard con estado, origen, destino y
  botón \"Continuar viaje\" que navega a loading_driver."
```

---

### Task 3: Drawer respeta safe area inferior

**Files:**
- Modify: `tukytuk/lib/widgets/drawer.dart`

**Interfaces:**
- Consumes: ninguno.
- Produces: el `Drawer` deja un padding inferior igual a `MediaQuery.viewPadding.bottom` para no taparse con la barra de navegación Android.

- [ ] **Step 1: Envolver el contenido del Drawer en SafeArea (apertura)**

Abrir `tukytuk/lib/widgets/drawer.dart`. Localizar el `return Drawer(child: ListView(...))` (aprox. línea 16).

Reemplazar EXACTAMENTE:

```dart
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: <Widget>[
```

Por:

```dart
    return Drawer(
      child: SafeArea(
        top: false,
        bottom: true,
        child: ListView(
          padding: EdgeInsets.zero,
          children: <Widget>[
```

- [ ] **Step 2: Cerrar el SafeArea (cierre)**

Localizar el final del método `build` del `DrawerWidget`. Antes del cambio el final es:

```dart
        ],
      ),
    );
  }
}
```

Donde:
- `],` cierra el `children: <Widget>[]` del ListView.
- `),` cierra el `ListView(...)`.
- `);` cierra el `Drawer(...)`.
- `}` cierra el método `build`.
- `}` final cierra la clase `DrawerWidget`.

Reemplazar EXACTAMENTE ese bloque final por:

```dart
          ],
        ),
      ),
    );
  }
}
```

Se agregó un nivel más de cierre `),` para el `SafeArea` y se indentó un nivel adicional el resto, manteniendo la consistencia con la apertura del Step 1.

Verificar visualmente que la estructura es `Drawer( SafeArea( ListView(...) ) )` con paréntesis balanceados.

- [ ] **Step 3: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/widgets/drawer.dart
```

Esperado: 0 errores, 0 warnings nuevos.

- [ ] **Step 4: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/widgets/drawer.dart
git commit -m "fix(drawer): SafeArea inferior para no taparse con nav bar Android

El contenido del drawer quedaba debajo de los controles de navegación
del sistema en algunos dispositivos. Envolver el ListView en
SafeArea(top: false, bottom: true) deja el header pegado arriba y
respeta el padding inferior."
```

---

### Task 4: `MapDriverScreen` dibuja ruta también en estado P

**Files:**
- Modify: `tukytuk/lib/screens/map_driver_screen.dart`

**Interfaces:**
- Consumes: ninguno nuevo.
- Produces: en estado P, el screen dibuja las mismas dos polylines y tres markers que en S/A.

- [ ] **Step 1: Actualizar el guard de `_loadDriverRoutes`**

Abrir `tukytuk/lib/screens/map_driver_screen.dart`. Localizar el guard en `_loadDriverRoutes` (aprox. línea 121):

```dart
    final status = authService.userStatus;
    if (status != 'S' && status != 'A') {
      debugPrint('MapDriverScreen: status=$status, no calculo rutas');
      return;
    }
```

Reemplazar por:

```dart
    final status = authService.userStatus;
    if (status != 'S' && status != 'A' && status != 'P') {
      debugPrint('MapDriverScreen: status=$status, no calculo rutas');
      return;
    }
```

Solo se cambia el guard — el render existente (dos polylines + tres markers) ya sirve para P.

- [ ] **Step 2: Verificar compilación**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter analyze lib/screens/map_driver_screen.dart
```

Esperado: 0 errores. Los 3 warnings de `unused_local_variable` (`searchBloc`, `tripResponse`) son pre-existentes — no contar.

- [ ] **Step 3: Commit**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
git add lib/screens/map_driver_screen.dart
git commit -m "fix(map-driver): dibuja ruta también cuando el viaje está en estado P

El guard de _loadDriverRoutes saltaba si status != 'S' && != 'A',
dejando al conductor en estado P sin ruta ni marker. Agregar P al
allowlist — el render existente (conductor→recogida + recogida→destino)
aplica también en progreso, per decisión del usuario."
```

---

### Task 5: Verificación end-to-end en dispositivo y backend

**Files:** ninguno modificado — verificación manual.

**Interfaces:** valida los 3 fixes en un flujo completo.

- [ ] **Step 1: Arrancar backend**

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytukapi
npm run start:dev
```

Esperado: arranca sin errores. Si el módulo de trip.js está roto, falla aquí.

- [ ] **Step 2: Arrancar app**

En otra terminal:

```bash
cd /Users/yordiguevara/Documents/GitHub/TukyTuk/tukytuk
flutter run -d R5CT63D67ZM
```

Si falla con `Gradle task assembleDebug failed with exit code 1`, ejecutar `cd android && ./gradlew --stop` y reintentar.

- [ ] **Step 3: Verificar Fix 1 — home conductor con viaje activo**

1. Loguearse como conductor que tiene un viaje en estado A o P.
2. En `HomePage` verificar:
   - Aparece el card grande "Viaje en curso" con icono auto azul.
   - Subtítulo refleja el estado ("Yendo a recoger al pasajero" para A, "En viaje" para P).
   - Muestra origen y destino.
   - NO aparece la sección "Viajes Disponibles" ni "0".
   - Botón "Continuar viaje" navega a `loading_driver` → `MapDriverScreen`.
3. Cerrar sesión y entrar como otro conductor SIN viaje activo:
   - El card NO aparece.
   - La sección "Viajes Disponibles" sí aparece (vacía o con trips disponibles).

- [ ] **Step 4: Verificar Fix 2 — drawer no se tapa con nav bar**

1. Desde cualquier pantalla con drawer (HomePage, TripDriverPage), abrir el menú lateral.
2. Confirmar que el último item del drawer (probablemente "Cerrar sesión" o similar) queda por encima de los botones de navegación Android — NO debajo.
3. Tocar el último item: debe responder al tap.

- [ ] **Step 5: Verificar Fix 3 — ruta en estado P**

1. Con un viaje en progreso (status P), entrar a `MapDriverScreen` (vía el botón "Continuar viaje" del card).
2. En consola, buscar logs `MapDriverScreen:`. Confirmar:
   - `MapDriverScreen: driver=(...) pickup=(...) destination=(...)` aparece.
   - `MapDriverScreen: ruta A devolvió N pts ...` y `ruta B devolvió M pts ...` aparecen con N y M > 0.
   - NO aparece `status=P, no calculo rutas`.
3. En el mapa visualmente:
   - Polyline azul (recogida→destino).
   - Polyline naranja (conductor→recogida).
   - 3 markers (azure auto, naranja recogida, rojo destino).
   - El punto azul nativo de Google Maps debe ser visible (ubicación del conductor).

- [ ] **Step 6: Reportar resultados**

Si todas las verificaciones pasan, no se requiere commit adicional. Si alguna falla, abrir el bug específico con logs y captura.
