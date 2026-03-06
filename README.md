# MessageHub - Unified Messaging SaaS

> Plataforma multi-tenant para centralizar WhatsApp Business, Instagram y Messenger

## Estructura del Repositorio

```
message-hub/
├── apps/web/           # Frontend - React 19 + TypeScript + Vite + Tailwind
├── functions/          # Backend  - Firebase Cloud Functions (webhooks, AI)
├── docs/               # Guias de integracion y despliegue
├── legacy/             # Codigo anterior (vanilla JS) - NO ACTIVO
├── firebase.json       # Configuracion Firebase (Firestore, Storage, Functions, Hosting)
├── firestore.rules     # Reglas de seguridad Firestore
├── firestore.indexes.json
└── storage.rules       # Reglas de seguridad Storage
```

## Tech Stack

### Frontend (`apps/web/`)
- React 19, TypeScript 5.7, Vite 6
- Tailwind CSS 4, Radix UI
- Zustand (state), React Query (data fetching)
- Firebase SDK (Auth, Firestore, Storage)

### Backend (`functions/`)
- Firebase Cloud Functions (Node.js 18)
- Webhooks: WhatsApp Business API, Instagram, Messenger, Evolution API
- AI Auto-responder (OpenAI / Anthropic)
- Pagos: Stripe, MercadoPago

### Deploy
- **Frontend**: GitHub Pages via GitHub Actions (`apps/web/dist/`)
- **Backend**: Firebase Cloud Functions
- **CI/CD**: `.github/workflows/deploy.yml`

## Quick Start

```bash
# Clonar el repositorio
git clone https://github.com/pitsecommerce-beep/message-hub.git
cd message-hub

# Instalar dependencias del frontend
cd apps/web
cp .env.example .env    # Configurar variables de Firebase
pnpm install
pnpm run dev            # Servidor de desarrollo en localhost
```

## Documentacion

- [Despliegue de Cloud Functions](docs/DEPLOY.md)
- [Integracion con Meta (WhatsApp, Instagram, Messenger)](docs/GUIA-INTEGRACION-META.md)
- [Configuracion de Evolution API](docs/EVOLUTION_API_SETUP.md)
- [Configuracion del Agente IA](docs/INSTRUCTIVO_AGENTE_IA.md)

## Features

- Multi-tenant architecture con organizaciones independientes
- Roles: Admin, Manager, Agent
- Autenticacion: Email, Google, Facebook (Firebase Auth)
- Conversaciones en tiempo real (Firestore)
- Agente IA con base de conocimiento
- Gestion de contactos y pedidos
- Links de pago (Stripe / MercadoPago)
- Integracion WhatsApp Business API + Evolution API (QR)
