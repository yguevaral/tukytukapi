# tukytukapi

Backend REST + realtime de la plataforma **TukyTuk** (mototaxi). Maneja autenticación, usuarios (pasajeros y conductores), ciclo de vida de viajes, mensajería y pagos.

## Stack

| Componente | Tecnología |
|---|---|
| Runtime | Node.js + Express |
| Base de datos | MongoDB (Mongoose) |
| Realtime | Socket.IO |
| Auth | JWT vía header `x-token` + OTP por email |
| Upload de archivos | Multer (comprobantes de pago) |
| Deploy | AWS EC2 — `http://52.87.214.235` |

## Quick start

```bash
npm install
cp .env.example .env   # editar PORT, DB_CNN, JWT_KEY, SMTP_*
npm run start:dev      # nodemon — auto-reload
npm start              # producción
```

No hay suite de tests automatizados (`npm test` es un placeholder).

## Estructura

```
controllers/    # business logic
helpers/        # email (SMTP), jwt utils
middlewares/   # validar-jwt, validar-campos
models/        # Mongoose schemas (Usuario, Trip, Mensaje, OTPCode, Payment...)
routes/        # Express routers + express-validator
sockets/       # Socket.IO handlers (chat, location-update)
index.js       # wiring principal
```

## Convenciones

- Idioma: español en comentarios, mensajes de error y commits.
- Mongoose `toJSON` sobrescrito en cada modelo: oculta `_id`/`__v`/`password`, expone `uid`.
- Auth: cada ruta protegida usa `validar-jwt` middleware → `req.uid` disponible.
- Sockets: cada usuario entra a la room nombrada por su `uid` al conectarse.

## Reglas del negocio clave

- Un conductor solo puede tener UN viaje activo simultáneo (`driver_status` ∈ {R, P}).
- Cancelación de viaje permitida por el pasajero en estados S, A, P.
- Estados `user_status`: `S` (solicitado), `A` (asignado), `P` (en progreso), `F` (finalizado), `C` (cancelado).
- Estados `driver_status`: `P` (default — pendiente de asignación o en progreso con pasajero), `R` (en ruta a recoger), `F` (finalizado). El valor `P` se reutiliza para ambos significados — el ciclo real es: `P` (pendiente) → `R` (en ruta) → `P` (en progreso) → `F` (finalizado).

## Para agentes de IA

- Instrucciones globales del monorepo: `../CLAUDE.md`
- Specs y planes de trabajo: `../docs/superpowers/`
- Arquitectura completa con diagramas: `../docs/ARCHITECTURE.md`
