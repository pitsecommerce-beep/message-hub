# Plan de Migración: Stack MVP → Stack de Producción

## 1. Diagnóstico del Stack Actual

### ¿Qué tenemos hoy?

| Capa | Tecnología actual | Tamaño |
|------|-------------------|--------|
| Frontend | Vanilla HTML + CSS + JS | 1,439 + 4,417 + 4,710 líneas en 3 archivos |
| Backend | Firebase Cloud Functions (Node 18, JS) | ~1,500 líneas |
| Base de datos | Firestore | — |
| Autenticación | Firebase Auth (SDK directo en cliente) | — |
| Hosting | Firebase Hosting | — |
| Build | Ninguno | — |
| Tipos | Ninguno (JavaScript puro) | — |

---

## 2. Problemas Concretos del Stack Actual

### Frontend

**1. Un archivo de 4,710 líneas no escala**
- `app.js` mezcla: autenticación, estado global, llamadas a Firebase, manipulación del DOM, lógica de negocio, renderizado y manejo de eventos. No hay separación de responsabilidades.
- Cualquier bug o feature nueva requiere navegar miles de líneas para entender el contexto.

**2. Estado global con variables sueltas**
```js
// Estado actual — cualquier función puede mutar cualquier cosa
let currentUser = null;
let conversations = [];
let currentConversation = null;
let orders = [];
// ...10+ variables más sin control
```
No hay un contrato claro de qué función modifica qué estado. Los bugs de estado son imposibles de trazar.

**3. Manipulación del DOM imperativa**
- Cada actualización de UI requiere código manual: `innerHTML`, `querySelector`, `addEventListener`. No hay reactividad.
- Al cambiar los datos hay que recordar qué partes del DOM actualizar manualmente.

**4. Sin sistema de componentes**
- El CSS tiene 4,417 líneas en un solo archivo global. Cualquier cambio puede romper estilos en lugares inesperados.
- Los componentes de UI (modales, toasts, tablas) están duplicados en el HTML y recreados en JS.

**5. Sin tipado**
- No hay autocompletado real, no hay detección de errores en compile time, no hay contratos entre módulos.
- Pasar un campo incorrecto a una función falla silenciosamente en runtime.

**6. Sin build process**
- No hay tree shaking, no hay code splitting, no hay optimización de assets.
- Todo el JS se carga en un solo bloque al inicio.

**7. Sin router**
- La "navegación" es `showPage()` / `showPageDirect()` con `display: none` / `display: block`.
- No hay rutas en la URL, no hay deep linking, no hay historial del navegador.

### Backend (Cloud Functions)

**1. Sin TypeScript**
- Los parámetros de funciones como `saveOrUpdateContact`, `createOrder`, `findAgentForPlatform` no tienen tipos. Un error en el llamado falla en runtime en producción.

**2. Acoplamiento a Firebase**
- El código está 100% acoplado al ecosistema Firebase: imposible hacer unit tests sin emuladores, imposible migrar a otra base de datos sin reescribir todo.

**3. Sin framework HTTP real**
- Los webhooks usan `onRequest` de Firebase Functions con manejo manual de rutas (`req.method === 'GET'`, `req.method === 'POST'`). No hay middleware, no hay validación de schemas, no hay manejo de errores centralizado.

**4. Sin validación de entrada**
- Los webhooks de Meta y MercadoPago procesan el body directamente sin validar la estructura. Un payload inesperado puede crashear la función silenciosamente.

**5. Sin logging estructurado**
- `console.log` en todo el código. En producción con múltiples orgs y conversaciones simultáneas, imposible correlacionar logs de una request específica.

**6. Sin rate limiting ni throttling**
- Los webhooks no tienen protección contra abuso. Un actor malicioso puede saturar las Cloud Functions.

**7. Búsqueda semántica hecha a mano**
- El sistema de `AUTOPARTE_EXPANSIONS` en `firestore.js` (líneas 405–534) es un diccionario hardcodeado. Frágil, difícil de mantener, y limitado al dominio de autopartes.

---

## 3. Stack Objetivo

### Frontend: React + TypeScript + Vite

```
Frontend/
├── Framework:    React 18+ (con concurrent features)
├── Lenguaje:     TypeScript 5.x
├── Build tool:   Vite 5+ (HMR rápido, ESM nativo)
├── Router:       React Router v7 (o TanStack Router)
├── Estado:       Zustand (estado global ligero) + TanStack Query (server state)
├── UI:           Radix UI primitives + Tailwind CSS v4
├── Formularios:  React Hook Form + Zod
├── Tablas:       TanStack Table v8
├── Gráficas:     Recharts
├── Excel:        SheetJS (el mismo, ahora con wrapper React)
└── Notif.:       Sonner (toast ligero)
```

**Node mínimo:** 20 LTS (o 22 LTS)

### Backend: Express.js + TypeScript

```
Backend/
├── Framework:    Express.js 4.x (con types @types/express)
├── Lenguaje:     TypeScript 5.x
├── Runtime:      Node.js 22 LTS
├── Validación:   Zod (mismo schema en frontend y backend)
├── Autenticación:firebase-admin (verificación de JWT de Firebase Auth)
├── Logging:      Pino (JSON estructurado, muy rápido)
├── HTTP client:  Axios (reemplaza node-fetch)
├── Rate limiting:express-rate-limit
├── Seguridad:    Helmet (headers HTTP seguros)
├── CORS:         cors
├── Dev:          tsx (ejecuta TS directamente), nodemon
└── Tests:        Vitest + Supertest
```

---

## 4. Plan de Migración por Fases

La estrategia es **strangler fig**: el nuevo stack convive con el viejo, migrando módulo por módulo. En ningún momento se rompe la aplicación existente.

---

### Fase 0: Preparación (sin tocar funcionalidad)

**Objetivo:** Estructura de monorepo, tooling base, CI/CD.

```
message-hub/           ← repo actual (se convierte en monorepo)
├── apps/
│   ├── web/           ← nueva app React (reemplaza index.html + app.js)
│   └── api/           ← nuevo servidor Express (reemplaza Cloud Functions)
├── packages/
│   └── types/         ← tipos compartidos frontend/backend (Zod schemas)
├── functions/         ← Cloud Functions existentes (se mantienen en paralelo)
├── index.html         ← frontend actual (se mantiene en paralelo)
├── app.js             ← código actual (se mantiene en paralelo)
└── package.json       ← workspace root
```

**Tareas concretas:**

1. Agregar `pnpm` workspaces (o npm workspaces) en `package.json` raíz
2. Crear `apps/web` con Vite + React + TypeScript
3. Crear `apps/api` con Express + TypeScript + estructura base
4. Crear `packages/types` con Zod schemas compartidos
5. Configurar `tsconfig.json` base + paths aliases
6. Configurar ESLint + Prettier en todos los paquetes
7. Agregar GitHub Actions: lint + typecheck + tests en cada PR

**Tecnología nueva en esta fase:**
- `pnpm` workspaces
- `TypeScript 5.x`
- `ESLint` + `Prettier`
- `Vite 5`

---

### Fase 1: Backend — Express.js base + webhooks

**Objetivo:** Reemplazar los webhooks de Firebase Cloud Functions con Express.js.

#### Estructura de `apps/api/`

```
apps/api/
├── src/
│   ├── index.ts              ← entry point (app.listen)
│   ├── app.ts                ← Express app factory (para testing)
│   ├── config/
│   │   └── env.ts            ← zod validation de process.env
│   ├── middleware/
│   │   ├── auth.ts           ← verifica Firebase JWT
│   │   ├── errorHandler.ts   ← manejo centralizado de errores
│   │   └── rateLimiter.ts    ← express-rate-limit config
│   ├── routes/
│   │   ├── webhooks/
│   │   │   ├── whatsapp.ts
│   │   │   ├── instagram.ts
│   │   │   ├── messenger.ts
│   │   │   └── mercadopago.ts
│   │   └── api/
│   │       ├── conversations.ts
│   │       ├── contacts.ts
│   │       ├── orders.ts
│   │       ├── agents.ts
│   │       └── knowledgeBases.ts
│   ├── services/
│   │   ├── firestore.service.ts   ← misma lógica de firestore.js pero tipada
│   │   ├── ai.service.ts          ← autoResponder.js refactorizado
│   │   ├── meta.service.ts        ← llamadas a Meta Graph API
│   │   └── mercadopago.service.ts
│   └── types/                ← re-exporta de packages/types
├── package.json
├── tsconfig.json
└── .env.example
```

#### Librerías clave (reemplazos directos)

| Antes | Ahora | Motivo |
|-------|-------|--------|
| `firebase-functions onRequest` | `express` Router | Framework HTTP real, testeable |
| `req.method === 'GET'` | `router.get()` | Legible, estándar |
| `node-fetch` | `axios` | Tipado, interceptors, mejor DX |
| `console.log` | `pino` | JSON estructurado, correlation IDs |
| Sin validación | `zod.parse()` en cada request | Falla rápido con mensajes claros |
| Sin auth middleware | `middleware/auth.ts` | Centralizado, reutilizable |
| Sin rate limit | `express-rate-limit` | Protección básica inmediata |

#### Ejemplo: webhook WhatsApp refactorizado

```typescript
// apps/api/src/routes/webhooks/whatsapp.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { whatsappWebhookSchema } from '@message-hub/types';
import { processWhatsAppMessage } from '../../services/meta.service';
import { logger } from '../../lib/logger';

const router = Router();

// GET — verificación del hub
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST — mensajes entrantes
router.post('/', async (req: Request, res: Response) => {
  // Responder inmediatamente a Meta (evita reintento)
  res.sendStatus(200);

  const parsed = whatsappWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ error: parsed.error }, 'Invalid WhatsApp webhook payload');
    return;
  }

  await processWhatsAppMessage(parsed.data).catch((err) => {
    logger.error({ err }, 'Error processing WhatsApp message');
  });
});

export default router;
```

**Tareas concretas:**

1. Migrar los 4 webhooks (WhatsApp, Instagram, Messenger, MercadoPago) a Express Router
2. Migrar `firestore.js` a `firestore.service.ts` con tipos completos
3. Migrar `autoResponder.js` a `ai.service.ts` con tipos completos
4. Agregar validación Zod en cada webhook
5. Configurar Pino con request ID en cada request
6. Agregar Helmet + CORS configurado
7. Agregar `express-rate-limit` en rutas de webhook
8. Tests básicos con Vitest + Supertest para cada webhook

**Despliegue:** El servidor Express puede correr en:
- **Cloud Run** (recomendado: pago por uso, auto-escala, mismo proyecto GCP)
- **Railway / Render** (opción más simple para empezar)
- **VPS / Docker** (máximo control)

---

### Fase 2: Backend — API REST para el frontend

**Objetivo:** Exponer endpoints REST que el nuevo frontend React va a consumir (reemplaza llamadas directas de Firestore desde el cliente).

#### Endpoints a crear

```
GET    /api/conversations
GET    /api/conversations/:id
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages

GET    /api/contacts
POST   /api/contacts
PUT    /api/contacts/:id
DELETE /api/contacts/:id

GET    /api/orders
POST   /api/orders
PUT    /api/orders/:id

GET    /api/agents
POST   /api/agents
PUT    /api/agents/:id

GET    /api/knowledge-bases
POST   /api/knowledge-bases
PUT    /api/knowledge-bases/:id
POST   /api/knowledge-bases/:id/rows/import

GET    /api/integrations
PUT    /api/integrations/:platform

GET    /api/team
POST   /api/team/invite
DELETE /api/team/:userId
```

**Beneficio:** El frontend deja de hablar con Firestore directamente. Toda la lógica queda en el servidor, los Firestore rules se simplifican, y es posible cambiar de base de datos en el futuro sin tocar el frontend.

---

### Fase 3: Frontend — React base + autenticación

**Objetivo:** Reemplazar `index.html` + autenticación + routing.

#### Estructura de `apps/web/`

```
apps/web/
├── src/
│   ├── main.tsx                    ← entry point
│   ├── App.tsx                     ← router root
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   └── OnboardingPage.tsx
│   │   └── app/
│   │       ├── DashboardPage.tsx
│   │       ├── ConversationsPage.tsx
│   │       ├── ContactsPage.tsx
│   │       ├── OrdersPage.tsx
│   │       ├── KnowledgeBasePage.tsx
│   │       ├── AgentsPage.tsx
│   │       ├── IntegrationsPage.tsx
│   │       └── TeamPage.tsx
│   ├── components/
│   │   ├── ui/              ← Radix UI wrappers (Button, Modal, Toast, etc.)
│   │   ├── conversations/   ← ConversationList, MessageThread, etc.
│   │   ├── contacts/        ← ContactTable, FunnelBoard, etc.
│   │   ├── orders/          ← OrderList, OrderForm, etc.
│   │   └── layout/          ← Sidebar, TopBar, etc.
│   ├── hooks/
│   │   ├── useAuth.ts       ← Firebase Auth state
│   │   ├── useConversations.ts  ← TanStack Query
│   │   ├── useContacts.ts
│   │   └── ...
│   ├── store/
│   │   └── app.store.ts     ← Zustand: solo UI state (panel activo, etc.)
│   ├── lib/
│   │   ├── api.ts           ← axios instance configurado
│   │   ├── firebase.ts      ← Firebase app init
│   │   └── queryClient.ts   ← TanStack Query config
│   └── types/               ← re-exporta de packages/types
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

#### Separación de estado (reemplaza variables globales)

| Estado actual (global) | Estado nuevo | Tecnología |
|------------------------|--------------|------------|
| `currentUser` | `useAuth()` hook | Firebase Auth |
| `conversations[]` | `useQuery(['conversations'])` | TanStack Query |
| `currentConversation` | URL param + `useQuery(['conversation', id])` | React Router + TanStack Query |
| `orders[]`, `contacts[]` | `useQuery(...)` con cache | TanStack Query |
| Panel activo (sidebar) | `useAppStore()` | Zustand |
| Filtros activos | URL search params | React Router |

**El 90% del estado desaparece** porque TanStack Query maneja cache, loading, error, y refetch automáticamente.

#### Ejemplo: ConversationList refactorizado

```typescript
// apps/web/src/components/conversations/ConversationList.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Conversation } from '@message-hub/types';

export function ConversationList() {
  const { data: conversations, isLoading, error } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/conversations').then(r => r.data),
    refetchInterval: 5000, // polling cada 5s (o usar WebSocket más adelante)
  });

  if (isLoading) return <ConversationSkeleton />;
  if (error) return <ErrorState error={error} />;

  return (
    <ul>
      {conversations?.map(conv => (
        <ConversationItem key={conv.id} conversation={conv} />
      ))}
    </ul>
  );
}
```

---

### Fase 4: Frontend — Módulos principales

**Orden recomendado (por impacto y dependencias):**

1. **Dashboard** — Gráficas con Recharts, stats con cards
2. **Conversations** — Lista + hilo de mensajes (componente más complejo)
3. **Contacts + Funnel** — Tabla con TanStack Table + drag-drop con `@dnd-kit/core`
4. **Orders** — Formulario con React Hook Form + Zod
5. **Knowledge Base** — Tabla editable + import Excel con SheetJS
6. **Agents / Integrations / Team** — Formularios de configuración

---

### Fase 5: Tipos compartidos (`packages/types`)

**Objetivo:** Un solo lugar para los contratos entre frontend y backend.

```typescript
// packages/types/src/conversation.ts
import { z } from 'zod';

export const ConversationSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  contactPhone: z.string().optional(),
  platform: z.enum(['whatsapp', 'instagram', 'messenger']),
  status: z.enum(['open', 'closed']),
  funnelStage: z.string(),
  aiEnabled: z.boolean(),
  lastMessage: z.string().optional(),
  lastMessageAt: z.date(),
  unreadCount: z.number().int().min(0),
});

export type Conversation = z.infer<typeof ConversationSchema>;

// El backend valida con: ConversationSchema.parse(data)
// El frontend tiene tipos con: typeof Conversation
```

Mismo schema → misma validación → cero desincronización entre capas.

---

## 5. Librerías Clave y Por Qué

### Frontend

| Librería | Reemplaza | Por qué |
|----------|-----------|---------|
| `react` | DOM imperativo | Reactividad declarativa, ecosistema maduro |
| `react-router-dom v7` | `showPage()` manual | URL real, deep linking, historial |
| `@tanstack/react-query` | Variables globales + listeners Firestore | Cache, loading states, invalidación automática |
| `zustand` | Variables globales de UI | Mínimo boilerplate, TypeScript nativo |
| `react-hook-form` + `zod` | Validación manual de forms | Performante, tipado end-to-end |
| `@tanstack/react-table` | Tablas HTML manuales | Sort, filter, paginación, virtualization |
| `@radix-ui` | Modales/dropdowns manuales | Accesible, sin estilos impuestos |
| `tailwindcss v4` | CSS global de 4,417 líneas | Utilidades atómicas, sin conflictos globales |
| `recharts` | Canvas manual | React-nativo, responsive, fácil de customizar |
| `@dnd-kit/core` | Drag-drop manual | Accesible, moderno, TypeScript |
| `sonner` | Toasts manuales | Un import, 0 configuración |

### Backend

| Librería | Reemplaza | Por qué |
|----------|-----------|---------|
| `express` | `firebase-functions onRequest` | Framework real, middleware, routing, testeable |
| `zod` | Sin validación | Validación runtime + tipos TypeScript |
| `pino` | `console.log` | JSON estructurado, request IDs, muy rápido |
| `axios` | `node-fetch` | Interceptors, tipado, manejo de errores |
| `helmet` | Sin headers | Seguridad HTTP básica en un import |
| `cors` | Manual | Configuración centralizada y clara |
| `express-rate-limit` | Sin límites | Protección contra abuso en webhooks |
| `vitest` + `supertest` | Sin tests | Unit + integration tests rápidos |

---

## 6. Despliegue del Nuevo Stack

### Frontend (React)
```
Opción A: Firebase Hosting  → build estático, CDN incluido
Opción B: Vercel             → deploy automático en cada push, Edge Network
Opción C: Cloudflare Pages  → más rápido globalmente, free tier generoso
```
Recomendado: **Vercel** — integración con GitHub en 2 clicks, previews por PR, zero config para Vite.

### Backend (Express)
```
Opción A: Cloud Run (GCP)  → mismo proyecto, pago por uso, auto-escala a 0
Opción B: Railway           → más simple, buen free tier para empezar
Opción C: Render            → similar a Railway
```
Recomendado: **Cloud Run** — ya están en GCP con Firebase, evita cambiar de proveedor, escala bien.

### Versión de Node
- **Node 22 LTS** (activo hasta abril 2027) en ambos proyectos
- Especificar en `.nvmrc` y `package.json engines`

---

## 7. Lo que NO Cambia (y por qué)

| Componente | Decisión | Razón |
|------------|----------|-------|
| **Firestore** | Se mantiene | Escala muy bien, multi-tenant funciona, migrar la DB es el cambio más costoso |
| **Firebase Auth** | Se mantiene | El JWT de Firebase se verifica en Express con `firebase-admin`, cero fricción |
| **Firebase Admin SDK** | Se mantiene en el backend | Permite operaciones privilegiadas en Firestore |
| **OpenAI / Anthropic** | Se mantienen | Ya están bien integrados, moverlos a servicios tipados es suficiente |
| **Meta Webhooks** | Se mantienen | La lógica cambia solo de Cloud Functions a Express routes |
| **MercadoPago** | Se mantiene | Mismo patrón |

---

## 8. Resumen de Migración por Archivo

| Archivo actual | Migra a | Tamaño estimado resultado |
|----------------|---------|--------------------------|
| `index.html` (1,439 líneas) | `apps/web/src/routes/` (~20 componentes) | 50–100 líneas por componente |
| `app.js` (4,710 líneas) | `apps/web/src/` (hooks, stores, components) | Distribuido en ~40 archivos |
| `styles.css` (4,417 líneas) | Tailwind utilities + `apps/web/src/components/ui/` | CSS reducido en 80% |
| `functions/src/utils/firestore.js` (676 líneas) | `apps/api/src/services/firestore.service.ts` | ~700 líneas tipadas |
| `functions/src/ai/autoResponder.js` (604 líneas) | `apps/api/src/services/ai.service.ts` | ~600 líneas tipadas |
| `functions/src/webhooks/*.js` (4 archivos) | `apps/api/src/routes/webhooks/*.ts` | ~150 líneas por webhook |

---

## 9. Checklist de Inicio

### Fase 0 — Semana 1
- [ ] Convertir repo en monorepo con pnpm workspaces
- [ ] Crear `apps/web` con `pnpm create vite@latest web --template react-ts`
- [ ] Crear `apps/api` con `express`, `typescript`, `tsx`
- [ ] Crear `packages/types` con Zod schemas para las entidades principales
- [ ] Configurar `tsconfig.json` base con `paths` aliases
- [ ] Configurar ESLint + Prettier con reglas compartidas
- [ ] Agregar `.nvmrc` con Node 22

### Fase 1 — Semana 2–3
- [ ] Migrar webhook WhatsApp a Express Router tipado
- [ ] Migrar webhook Instagram a Express Router tipado
- [ ] Migrar webhook Messenger a Express Router tipado
- [ ] Migrar webhook MercadoPago a Express Router tipado
- [ ] Migrar `firestore.js` → `firestore.service.ts`
- [ ] Migrar `autoResponder.js` → `ai.service.ts`
- [ ] Agregar Zod validation en todos los webhooks
- [ ] Agregar Pino logging con request ID
- [ ] Escribir tests para cada webhook (Vitest + Supertest)
- [ ] Deploy en Cloud Run (staging)

### Fase 2 — Semana 3–4
- [ ] Implementar middleware de autenticación (verificar Firebase JWT)
- [ ] Crear endpoints REST para conversations, contacts, orders
- [ ] Crear endpoints REST para agents, knowledge bases, integrations, team
- [ ] Documentar API (Zod schemas son suficientes como contrato)

### Fase 3 — Semana 4–5
- [ ] Setup React Router con rutas auth + app
- [ ] Implementar `useAuth()` hook con Firebase Auth
- [ ] Implementar Login, Register, Onboarding pages
- [ ] Configurar TanStack Query + axios instance
- [ ] Configurar Zustand store para UI state
- [ ] Deploy en Vercel (staging)

### Fases 4–5 — Semanas 5–8
- [ ] Migrar Dashboard
- [ ] Migrar Conversations (más complejo, priorizar)
- [ ] Migrar Contacts + Funnel
- [ ] Migrar Orders
- [ ] Migrar Knowledge Base
- [ ] Migrar Agents, Integrations, Team

---

## 10. Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Perder funcionalidad durante migración | El app actual sigue funcionando en paralelo durante todo el proceso |
| Inconsistencia de datos entre frontend viejo y nuevo | Ambos apuntan a la misma Firestore; no hay doble fuente de verdad |
| Curva de aprendizaje del equipo con TypeScript | Empezar con `"strict": false` y habilitar reglas gradualmente |
| Aumento de complejidad del build | Vite es extremadamente rápido y simple de configurar vs webpack |
| Costo de Cloud Run vs Cloud Functions | Cloud Run tiene free tier generoso, similar en costo a Cloud Functions 2nd gen |

---

## 11. Los 10 Pasos de Migración del Frontend

> **Estructura resultante:** `legacy/` conserva el frontend actual intacto. `apps/web/` es la nueva app React.

### Paso 1 ✅ Scaffolding + Tooling (COMPLETADO)
**Objetivo:** Estructura lista para empezar a escribir componentes reales.

**Qué se hizo:**
- `legacy/` — copia del frontend actual (`index.html`, `app.js`, `styles.css`)
- `apps/web/` — app Vite + React 19 + TypeScript 5.x
- Dependencias instaladas: React Router v7, TanStack Query, Zustand, Axios, Zod, Firebase, Sonner, Tailwind v4
- `vite.config.ts` — plugin `@tailwindcss/vite`, alias `@/` → `src/`
- `tsconfig.app.json` — strict mode + path aliases
- `.prettierrc` — Prettier con `prettier-plugin-tailwindcss`
- `.nvmrc` — Node 22
- `src/lib/firebase.ts` — Firebase app init con env vars
- `src/lib/query-client.ts` — TanStack Query con defaults
- `src/lib/api.ts` — Axios con interceptor de Firebase JWT automático
- `src/store/app.store.ts` — Zustand para estado de UI
- `src/hooks/use-auth.ts` — Hook de Firebase Auth state
- `src/types/index.ts` — Zod schemas para todas las entidades (Conversation, Message, Contact, Order, AiAgent)
- `src/App.tsx` — Router con todas las rutas + AuthGuard + GuestGuard + lazy loading
- Páginas placeholder en `src/routes/` para cada módulo
- `0 errores de TypeScript`

---

### Paso 2: Design System + Layout Shell
**Objetivo:** Sidebar, TopBar y sistema de componentes UI base. Todas las rutas muestran el layout real.

**Qué hacer:**
1. Instalar Radix UI primitives: `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-select`, `@radix-ui/react-avatar`, `class-variance-authority`, `clsx`, `tailwind-merge`
2. Crear `src/lib/utils.ts` con función `cn()` (merge de clases Tailwind)
3. Crear componentes UI base en `src/components/ui/`:
   - `Button.tsx` — variantes: primary, secondary, ghost, danger
   - `Badge.tsx` — variantes por plataforma y status
   - `Card.tsx` — contenedor con fondo `bg-card`
   - `Modal.tsx` — wrapper de `@radix-ui/react-dialog`
   - `Tooltip.tsx` — wrapper de `@radix-ui/react-tooltip`
   - `Spinner.tsx` — loading indicator
4. Crear `src/components/layout/`:
   - `AppLayout.tsx` — contenedor con sidebar + contenido
   - `Sidebar.tsx` — navegación con links activos via `useLocation()`
   - `TopBar.tsx` — título de página + avatar de usuario + logout
5. Envolver todas las rutas `/app/*` con `<AppLayout>`
6. Aplicar colores del design system existente con variables CSS de Tailwind

**Resultado:** Navegar entre páginas muestra el layout completo con sidebar funcional.

---

### Paso 3: Auth + Onboarding
**Objetivo:** Reemplazar el flujo de autenticación del `app.js` legacy.

**Qué hacer:**
1. Instalar: `react-hook-form`, `@hookform/resolvers`
2. `LoginPage.tsx` — form email/password + Google OAuth + Facebook OAuth
3. `RegisterPage.tsx` — form con nombre, email, password + validación Zod
4. `OnboardingPage.tsx` — wizard: elegir "Crear organización" o "Unirse como agente"
5. Lógica de auth en `src/hooks/use-auth.ts`:
   - `signInWithEmail()`, `signInWithGoogle()`, `signInWithFacebook()`
   - `signUp()` — registro + creación de organización o join con código
   - `signOut()`
6. Redirigir a `/onboarding` si el usuario no tiene `organizationId`
7. Mantener el flujo "deferred registration" del legacy

**Resultado:** Auth completa funcional. El usuario puede crear cuenta, hacer login y completar onboarding.

---

### Paso 4: API Layer + Datos en Tiempo Real
**Objetivo:** Conectar TanStack Query al backend (Firestore directamente por ahora, API REST cuando esté lista).

**Qué hacer:**
1. Crear hooks de datos en `src/hooks/`:
   - `use-conversations.ts` — `useQuery` sobre `/api/conversations`
   - `use-contacts.ts` — `useQuery` + `useMutation` para CRUD
   - `use-orders.ts` — `useQuery` + `useMutation`
   - `use-organization.ts` — datos del org actual
2. Por ahora, consultar Firestore directamente (igual que el legacy) hasta que exista la API Express
3. Definir patrón de invalidación: mutations → `queryClient.invalidateQueries()`
4. Agregar error boundaries con `react-error-boundary`
5. Agregar `@tanstack/react-query-devtools` en modo desarrollo

**Resultado:** Datos reales en la app, con cache automático, loading y error states manejados.

---

### Paso 5: Dashboard
**Objetivo:** Página de dashboard con datos reales y gráficas.

**Qué hacer:**
1. Instalar: `recharts`
2. `DashboardPage.tsx`:
   - Stat cards: conversaciones activas, órdenes nuevas, contactos
   - `<LineChart>` — conversaciones por día (últimos 7 días)
   - `<PieChart>` — distribución de funnel stages
   - Actividad reciente del equipo
3. Calcular stats desde TanStack Query (misma data que ya se cargó)
4. Responsive: 1 columna en mobile, grid en desktop

**Resultado:** Dashboard funcional con gráficas reales.

---

### Paso 6: Módulo de Conversaciones (el más complejo)
**Objetivo:** Lista de conversaciones + hilo de mensajes con actualizaciones en tiempo real.

**Qué hacer:**
1. `ConversationsPage.tsx` — layout split: lista izquierda, hilo derecha
2. `src/components/conversations/ConversationList.tsx`:
   - Filtros por plataforma (tabs: Todos, WhatsApp, Instagram, Messenger)
   - Ordenado por `lastMessageAt` desc
   - Indicador de no leídos
   - Skeleton loader
3. `src/components/conversations/MessageThread.tsx`:
   - Burbujas diferenciadas incoming/outgoing
   - Colores por plataforma
   - Auto-scroll al mensaje más reciente
   - Input para enviar mensaje
4. Real-time via Firestore `onSnapshot` (hook `use-messages.ts`)
5. Toggle AI enable/disable por conversación
6. URL reflects selected conversation: `/app/conversations/:id`

**Resultado:** Módulo de conversaciones completamente funcional, igual o mejor que el legacy.

---

### Paso 7: Contactos + Funnel Board
**Objetivo:** Tabla de contactos con búsqueda/sort + tablero kanban del funnel.

**Qué hacer:**
1. Instalar: `@tanstack/react-table`, `@dnd-kit/core`, `@dnd-kit/sortable`
2. `ContactsPage.tsx` — tabs: "Lista" y "Funnel"
3. Vista Lista — `src/components/contacts/ContactTable.tsx`:
   - TanStack Table con columnas: nombre, empresa, teléfono, email, etapa
   - Búsqueda por nombre/empresa/teléfono (client-side filtering)
   - Sort por cualquier columna
   - Row click → modal de edición
4. Vista Funnel — `src/components/contacts/FunnelBoard.tsx`:
   - 6 columnas, una por etapa
   - Drag & drop de contactos entre etapas con `@dnd-kit`
   - Al soltar → mutation que actualiza `funnelStage` en Firestore
5. Modal de contacto: ver/editar todos los campos

**Resultado:** CRM de contactos completo con funnel visual.

---

### Paso 8: Módulo de Órdenes
**Objetivo:** Lista de órdenes + creación de nuevas órdenes con formulario validado.

**Qué hacer:**
1. `OrdersPage.tsx` — lista de órdenes + botón "Nueva orden"
2. `src/components/orders/OrderList.tsx`:
   - TanStack Table con columnas: número, contacto, total, status, fecha
   - Filtro por status (todos / nuevo / confirmado / entregado)
   - Badge de color por status
3. `src/components/orders/OrderForm.tsx` (modal):
   - React Hook Form + Zod: seleccionar contacto, agregar items dinámicos
   - Cálculo automático del total
   - Submit → mutation que crea la orden en Firestore
4. Acción "Generar link de pago" → llama al API para crear link MercadoPago

**Resultado:** Gestión de órdenes funcional.

---

### Paso 9: Knowledge Base
**Objetivo:** CRUD de bases de conocimiento con import/export Excel.

**Qué hacer:**
1. Instalar: `xlsx` (SheetJS)
2. `KnowledgeBasePage.tsx` — lista de KBs + botón "Nueva KB"
3. Vista de KB individual:
   - TanStack Table con columnas dinámicas (basadas en `kb.columns`)
   - Celdas editables inline
   - Botón "Importar Excel" → FileReader + SheetJS → bulk insert
   - Botón "Exportar Excel" → SheetJS → descarga automática
4. Modal para crear/editar KB (nombre, descripción, definir columnas)

**Resultado:** Knowledge base funcional con misma capacidad de import/export que el legacy.

---

### Paso 10: Páginas de Configuración
**Objetivo:** Agentes IA, Integraciones, Equipo. Completa la paridad con el legacy.

**Qué hacer:**
1. `AgentsPage.tsx`:
   - Lista de agentes + crear/editar
   - Editor de system prompt (textarea grande)
   - Selector de provider (OpenAI/Anthropic) y modelo
   - Toggles por canal (WhatsApp, Instagram, Messenger)
   - Selector de knowledge bases a incluir
2. `IntegrationsPage.tsx`:
   - Cards por plataforma: WhatsApp, Instagram, Messenger, MercadoPago
   - Form de configuración por plataforma (access token, phone number ID, etc.)
3. `TeamPage.tsx`:
   - Lista de miembros con roles
   - Mostrar invite code + botón copiar
   - Botón expulsar miembro (con confirmación)

**Resultado:** App completa en React. Se puede desactivar `legacy/` y apuntar Firebase Hosting a `apps/web/dist`.

---

## 12. Resumen de Decisiones Técnicas del Paso 1

| Decisión | Elección | Alternativa descartada | Razón |
|----------|----------|----------------------|-------|
| Build tool | Vite 7 | Create React App | CRA está abandonado; Vite es 10-100x más rápido |
| React version | React 19 | React 18 | Ya es estable, concurrent features, mejor Suspense |
| Routing | React Router v7 | TanStack Router | RR7 tiene SSR/RSC ready, más maduro |
| Server state | TanStack Query | SWR | Más features, mejor DX, DevTools |
| Client state | Zustand | Redux/Jotai | Mínimo boilerplate, TypeScript nativo |
| CSS | Tailwind v4 | Tailwind v3 / CSS Modules | v4 usa CSS nativo, sin config file, más rápido |
| Validación | Zod v4 | Yup / Valibot | Mejor TypeScript inference, mismo schema FE+BE |
| HTTP | Axios | fetch nativo | Interceptors, tipado, mejor manejo de errores |
| Toasts | Sonner | react-hot-toast | Más features, mejor accesibilidad |
| Fuente | Outfit + JetBrains Mono | Sistema | Mantiene identidad visual del legacy |
