# 💬 MessageHub - Unified Messaging SaaS

> Plataforma multi-tenant para centralizar WhatsApp Business, Instagram y Messenger

![Status](https://img.shields.io/badge/Status-MVP_Ready-success) ![Tech](https://img.shields.io/badge/Stack-Firebase_+_Vercel-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

### 🎯 MVP (Listo)
- ✅ **Multi-tenant architecture** - Organizaciones independientes
- ✅ **Sistema de roles** - Admin y Agentes
- ✅ **Autenticación completa** - Email, Google, Facebook
- ✅ **Onboarding intuitivo** - Crear org o unirse con código
- ✅ **Gestión de equipo** - Invitaciones y permisos
- ✅ **UI moderna** - Diseño profesional y responsive

### 🔜 Próximo (Fase 2)
- 🚧 Integración WhatsApp Business API
- 🚧 Integración Instagram Messaging
- 🚧 Integración Messenger
- 🚧 Sistema de conversaciones en tiempo real
- 🚧 Envío y recepción de mensajes

## 🚀 Quick Start (5 minutos)

### 1. Clona el repositorio
```bash
git clone https://github.com/TU-USUARIO/messagehub-saas.git
cd messagehub-saas
```

### 2. Configura Firebase

**a) Crea proyecto en Firebase:**
- Ve a https://console.firebase.google.com/
- Click "Add project" → Nombre: `messagehub-saas`
- Deshabilita Analytics → Click "Create project"

**b) Habilita Authentication:**
- Authentication → Get started
- Habilita: Email/Password + Google

**c) Crea Firestore Database:**
- Firestore Database → Create database
- Production mode → Ubicación: `us-central1`

**d) Copia configuración:**
- Project settings → Your apps → Web app
- Copia el `firebaseConfig`

**e) Actualiza `index.html`** (línea ~360):
```javascript
const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_PROJECT.firebaseapp.com",
    projectId: "TU_PROJECT_ID",
    storageBucket: "TU_PROJECT.appspot.com",
    messagingSenderId: "TU_SENDER_ID",
    appId: "TU_APP_ID"
};
```

**f) Configura reglas de seguridad:**
- Copia las reglas de `ARQUITECTURA.md` → Paso 6
- Pega en Firestore → Rules → Publish

**g) Autoriza dominio:**
- Authentication → Settings → Authorized domains
- Agrega: `TU-USUARIO.github.io`

### 3. Deploy en GitHub Pages

**Opción A: Web**
1. Crea repo en GitHub
2. Sube archivos: `index.html`, `styles.css`, `app.js`
3. Settings → Pages → Source: main branch
4. ✅ Listo! Tu app estará en: `https://TU-USUARIO.github.io/messagehub-saas`

**Opción B: Terminal**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU-USUARIO/messagehub-saas.git
git push -u origin main
```

### 4. ¡Pruébalo!

1. Visita tu URL de GitHub Pages
2. Regístrate con email o Google
3. Elige "Create Organization"
4. Crea tu organización
5. Comparte el código de invitación con tu equipo

## 📁 Estructura del Proyecto

```
messagehub-saas/
├── index.html          # App principal
├── styles.css          # Estilos
├── app.js              # Lógica de aplicación
├── ARQUITECTURA.md     # Guía completa (60+ páginas)
└── README.md           # Este archivo
```

## 🛠️ Tech Stack

### Frontend
- HTML5 / CSS3 / JavaScript
- Firebase SDK (Auth + Firestore)
- GitHub Pages (hosting)

### Backend (Fase 2)
- Vercel (serverless functions)
- Supabase (PostgreSQL + real-time)
- Meta APIs (WhatsApp, Instagram, Messenger)

## 📖 Documentación Completa

Lee **[ARQUITECTURA.md](ARQUITECTURA.md)** para:
- 🏗️ Arquitectura detallada multi-tenant
- 🔥 Setup completo de Firebase
- 🚀 Deployment paso a paso
- 🔌 Integración con APIs de mensajería
- 💰 Estimación de costos
- 🗺️ Roadmap completo

## 🎨 Capturas de Pantalla

### Login & Signup
![Auth](https://via.placeholder.com/800x500?text=Modern+Authentication)

### Onboarding
![Onboarding](https://via.placeholder.com/800x500?text=Intuitive+Onboarding)

### Dashboard
![Dashboard](https://via.placeholder.com/800x500?text=Clean+Dashboard)

## 🔑 Flujo de Usuario

### Admin (Crear Organización)
1. Signup → Elige "Create Organization"
2. Ingresa nombre e industria
3. Recibe código de invitación
4. Comparte código con equipo
5. Gestiona conversaciones

### Agent (Unirse a Organización)
1. Signup → Elige "Join as Agent"
2. Ingresa código de invitación
3. Accede al workspace
4. Maneja conversaciones asignadas

## 🔐 Seguridad

- ✅ Autenticación Firebase
- ✅ Row-level security en Firestore
- ✅ HTTPS obligatorio (GitHub Pages)
- ✅ Validación de roles server-side
- ✅ Aislamiento completo entre organizaciones

## 📊 Modelo de Datos

```javascript
// Organizaciones
organizations/{orgId}
├── name: "Acme Inc."
├── ownerId: "user_xyz"
├── inviteCode: "ABCD-12345"
└── members: ["user_1", "user_2"]

// Usuarios
users/{userId}
├── name: "Juan Pérez"
├── organizationId: "org_abc"
├── role: "admin" | "agent"
└── onboarded: true

// Conversaciones (Fase 2)
conversations/{convId}
├── organizationId: "org_abc"
├── platform: "whatsapp"
├── contactId: "contact_123"
└── assignedTo: "user_1"
```

## 🗺️ Roadmap

- [x] **Fase 1 - MVP** (Completado)
  - Autenticación y multi-tenant
  - Onboarding y roles
  - Dashboard básico

- [ ] **Fase 2 - Integraciones** (4-6 sem)
  - WhatsApp Business API
  - Instagram Messaging API
  - Messenger API
  - Sistema de mensajería real-time

- [ ] **Fase 3 - Features** (6-8 sem)
  - Asignación de conversaciones
  - Búsqueda y filtros
  - Respuestas rápidas
  - Notificaciones

- [ ] **Fase 4 - Monetización** (2-3 sem)
  - Planes (Free, Pro, Enterprise)
  - Stripe integration
  - Billing

## 💰 Costos

### Gratis (0-100 usuarios)
```
GitHub Pages: $0
Firebase: $0
Meta APIs: $0
────────────
Total: $0/mes
```

### Crecimiento (100-1000 usuarios)
```
Supabase Pro: $25/mes
Vercel Pro: $20/mes
Meta APIs: $0
────────────
Total: $45/mes
```

## 🤝 Contribuir

Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea tu feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - mira [LICENSE](LICENSE) para detalles.

## 🙏 Créditos

- Diseño inspirado en las mejores SaaS modernas
- Stack tecnológico: Firebase, Vercel, Supabase
- APIs: Meta Platforms (WhatsApp, Instagram, Messenger)

## 📞 Soporte

- 📧 Email: [tu-email]
- 🐛 Issues: [GitHub Issues](https://github.com/TU-USUARIO/messagehub-saas/issues)
- 📚 Docs: [ARQUITECTURA.md](ARQUITECTURA.md)

---

**Hecho con ❤️ para emprendedores y equipos de ventas**

⭐ Si te gusta el proyecto, dale una estrella en GitHub!

🚀 ¿Listo para centralizar tus mensajes? Empieza ahora con el [Quick Start](#-quick-start-5-minutos)
