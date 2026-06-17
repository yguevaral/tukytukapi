# Reorganización de docs IA + READMEs por repo + arquitectura con diagramas

**Fecha:** 2026-06-17
**Estado:** Aprobado para implementación
**Alcance:** Solo documentación y reubicación de archivos. NO toca código de ninguno de los subproyectos.

## Problema

1. **Specs/plans atrapados en un repo subproyecto.** Toda la documentación de IA (specs y planes de Claude) vive en `tukytukapi/docs/superpowers/`, pero describe trabajo del MONOREPO entero (Flutter + backend + admin). Cuando un agente futuro edita `tukytuk/` (Flutter) o `tukytuk-admin/`, no tiene acceso natural a esa documentación sin saltar a otro git repo.
2. **READMEs por defecto en cada repo.** `tukytuk/README.md` y `tukytuk-admin/README.md` son los boilerplates de Flutter y Vite respectivamente — no explican el rol del subproyecto en la plataforma TukyTuk. `tukytukapi/` no tiene README.
3. **Falta documento de arquitectura.** El `CLAUDE.md` de la raíz cubre convenciones para agentes pero no explica visualmente el flujo del viaje, los estados, ni los flujos en tiempo real. Un colaborador humano que llega al monorepo necesita ese mapa.

## Solución

Tres bloques de trabajo, ningún código tocado:

### 1. Mover `tukytukapi/docs/superpowers/` a la raíz monorepo

- En `tukytukapi/`: `git rm -r docs/superpowers/` y commit ("docs: mover superpowers/ a la raíz del monorepo").
- En la raíz (`/Users/yordiguevara/Documents/GitHub/TukyTuk/`): el directorio queda como `docs/superpowers/` con todos sus `specs/` y `plans/`.
- La raíz NO es repo git, así que solo es una operación de filesystem. Los agentes futuros (Claude, Codex, etc.) que abran el monorepo ven la documentación independientemente de qué subproyecto editen.

### 2. READMEs por repositorio — estructura uniforme

Cada README tiene este esqueleto:

```markdown
# <Nombre del subproyecto>

<Una o dos líneas: rol en TukyTuk>

## Stack

| Componente | Tecnología |
|---|---|
| ... | ... |

## Quick start

```bash
<comandos verificados>
```

## Estructura

<árbol simplificado con responsabilidades clave>

## Convenciones

- Idioma: español en UI, comentarios y commits.
- <otras convenciones específicas del subproyecto>

## Para agentes de IA

Las instrucciones globales del monorepo viven en `../CLAUDE.md`.
Los specs y planes de trabajo en curso viven en `../docs/superpowers/`.
```

Archivos:

| Path | Acción |
|---|---|
| `tukytukapi/README.md` | **Crear**. Backend Node + Express + MongoDB + Socket.IO. |
| `tukytuk/README.md` | **Sobrescribir** boilerplate Flutter. App híbrida pasajero+conductor. |
| `tukytuk-admin/README.md` | **Sobrescribir** boilerplate Vite. Dashboard admin React + TS + MUI. |

Contenido específico de cada README: extraer del `CLAUDE.md` actual (que tiene la información canónica) y reorganizar en el formato anterior.

### 3. Documento de arquitectura con diagramas — `docs/ARCHITECTURE.md` en raíz

Estructura:

1. **Vista general** — 1 párrafo: TukyTuk como plataforma mototaxi, los tres componentes y su comunicación.

2. **Diagrama 1 — Topología del monorepo** (Mermaid `graph LR`):
   ```
   tukytuk-admin (React)   ──HTTP──→  tukytukapi (Node)  ←──HTTP+Sockets──  tukytuk (Flutter)
                                            │
                                            └──→  MongoDB
   ```

3. **Diagrama 2 — Ciclo de vida del viaje** (Mermaid `stateDiagram-v2`):
   - Estados de `user_status`: `S` (solicitado) → `A` (aceptado) → `P` (en progreso) → `F` (finalizado). Estado terminal alternativo: `C` (cancelado).
   - Transiciones etiquetadas con qué actor las dispara: pasajero (`solicita`, `confirma llegada`, `cancela`), conductor (`acepta`, `llega y arranca`, `finaliza`).

4. **Diagrama 3 — Flujo en tiempo real** (Mermaid `sequenceDiagram`):
   - Handshake JWT vía `x-token` header.
   - `client.join(uid)` al conectarse.
   - `location-update` emit del conductor → relay del backend al room del pasajero (y viceversa).
   - `trip-accepted` cuando el conductor acepta.
   - `trip-status-changed` cuando cambia el estado del viaje (incluye cancelaciones).

5. **Diagrama 4 — Flujo de pago / suscripción del conductor** (Mermaid `sequenceDiagram`):
   - Conductor sube comprobante (multipart) → `PaymentService` en backend.
   - Admin (dashboard) aprueba o rechaza.
   - Socket emit al conductor: `payment-approved` o `payment-rejected`.
   - El switch online del conductor se desbloquea cuando hay un pago aprobado vigente.

6. **Convenciones globales** — idioma español, JWT `x-token`, snake_case en el modelo Mongoose, etc.

7. **Reglas de negocio clave** — un viaje activo por conductor, cancelación permitida en S/A/P, polling cada 2-5s, etc.

Mermaid renderiza nativamente en GitHub y la mayoría de IDEs modernos — no se necesitan imágenes binarias.

## Archivos y operaciones

| Operación | Path |
|---|---|
| **Move dir** | `tukytukapi/docs/superpowers/` → `docs/superpowers/` (en raíz monorepo) |
| **Commit en `tukytukapi/`** | Remover `docs/superpowers/` del repo backend |
| **Crear** | `tukytukapi/README.md` |
| **Sobrescribir** | `tukytuk/README.md` |
| **Sobrescribir** | `tukytuk-admin/README.md` |
| **Crear** | `docs/ARCHITECTURE.md` (en raíz monorepo) |
| **Actualizar memoria** | `reference_ubicacion-specs.md` → nueva ruta `~/Documents/GitHub/TukyTuk/docs/superpowers/` |

## Fuera de alcance

- Tocar código en cualquier subproyecto.
- Crear `AGENTS.md` o `GEMINI.md` en raíz (solo Claude se usa hoy).
- Actualizar paths viejos referenciados dentro de specs/plans históricos (son artefactos congelados).
- Generar PNG/SVG de los diagramas (Mermaid es texto en markdown, suficiente).
- Hacer commits en `tukytuk/` y `tukytuk-admin/` por los READMEs nuevos — quedan a discreción del usuario después.

## Criterio de aceptación

1. `tukytukapi/docs/superpowers/` ya NO existe; existe `~/Documents/GitHub/TukyTuk/docs/superpowers/` con los mismos specs/plans.
2. Hay un commit en `tukytukapi/` que documenta la eliminación con mensaje en español.
3. Los tres subproyectos tienen un README con la estructura uniforme descrita.
4. `docs/ARCHITECTURE.md` (raíz) existe con los 4 diagramas Mermaid + secciones de convenciones y reglas.
5. La memoria de Claude tiene `reference_ubicacion-specs.md` actualizada con la nueva ruta.
