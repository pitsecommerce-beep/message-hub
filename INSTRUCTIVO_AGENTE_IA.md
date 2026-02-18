# INSTRUCTIVO: Configuración de Agentes de IA en MessageHub

Este documento explica paso a paso cómo configurar los agentes de inteligencia artificial en MessageHub para que atiendan conversaciones automáticamente y puedan consultar tus bases de datos.

---

## Tabla de Contenido

1. [Requisitos previos](#1-requisitos-previos)
2. [Crear tu primer Agente IA](#2-crear-tu-primer-agente-ia)
3. [Obtener una API Key](#3-obtener-una-api-key)
4. [Escribir el System Prompt](#4-escribir-el-system-prompt)
5. [Subir una Base de Datos desde Excel](#5-subir-una-base-de-datos-desde-excel)
6. [Vincular Base de Datos con el Agente](#6-vincular-base-de-datos-con-el-agente)
7. [Asignar Agentes a Canales](#7-asignar-agentes-a-canales)
8. [Activar la IA en una Conversación](#8-activar-la-ia-en-una-conversacion)
9. [Configurar Firebase Cloud Functions](#9-configurar-firebase-cloud-functions)
10. [Solución de Problemas](#10-solucion-de-problemas)

---

## 1. Requisitos Previos

Antes de empezar, necesitas:

- **Cuenta de MessageHub** con rol de **Gerente** (los agentes no pueden configurar IA)
- **Plan Firebase Blaze** (pago por uso) para poder usar Cloud Functions
- **Una API Key** de un proveedor de IA (ver sección 3)
- **Un archivo Excel** con los datos que quieras que tu agente consulte (opcional pero recomendado)

---

## 2. Crear tu Primer Agente IA

1. Inicia sesión en MessageHub como **Gerente**
2. En el menú lateral izquierdo, haz clic en **"Agentes IA"**
3. Haz clic en el botón **"+ Crear Agente"**
4. Llena los campos:

| Campo | Qué poner | Ejemplo |
|-------|-----------|---------|
| **Nombre del agente** | Un nombre descriptivo | "Agente de Ventas" |
| **Proveedor de IA** | La empresa de IA que usarás | OpenAI (GPT) o Anthropic (Claude) |
| **Modelo** | El modelo específico | GPT-4o o Claude Sonnet 4.5 |
| **API Key** | Tu clave de API (ver sección 3) | sk-proj-abc123... |
| **System Prompt** | Las instrucciones del agente (ver sección 4) | "Eres un agente de ventas..." |

5. Selecciona los **canales** donde operará (WhatsApp, Instagram, Messenger)
6. Asegúrate de que **"Agente activo"** esté marcado
7. Haz clic en **"Guardar Agente"**

---

## 3. Obtener una API Key

### Opción A: OpenAI (GPT)

1. Ve a [platform.openai.com](https://platform.openai.com)
2. Crea una cuenta o inicia sesión
3. Ve a **API Keys** en el menú lateral
4. Haz clic en **"Create new secret key"**
5. Dale un nombre (ej: "MessageHub") y haz clic en **"Create"**
6. **COPIA LA CLAVE INMEDIATAMENTE** (solo se muestra una vez)
7. La clave se ve así: `sk-proj-xxxxxxxxxxxxxxxxx`

**Costo aproximado:** $0.01 - $0.03 USD por conversación (varía según el modelo)

**Modelo recomendado:** GPT-4o (mejor calidad) o GPT-4o Mini (más económico)

### Opción B: Anthropic (Claude)

1. Ve a [console.anthropic.com](https://console.anthropic.com)
2. Crea una cuenta o inicia sesión
3. Ve a **API Keys** en configuración
4. Haz clic en **"Create Key"**
5. Dale un nombre y haz clic en **"Create"**
6. **COPIA LA CLAVE INMEDIATAMENTE**
7. La clave se ve así: `sk-ant-xxxxxxxxxxxxxxxxx`

**Costo aproximado:** $0.003 - $0.015 USD por conversación (varía según el modelo)

**Modelo recomendado:** Claude Sonnet 4.5 (mejor balance) o Claude Haiku 4.5 (más económico)

### Opción C: Proveedor Personalizado

Si usas un servicio compatible con la API de OpenAI (como Together AI, Groq, Fireworks, etc.):

1. Obtén tu API Key del proveedor
2. Selecciona "Personalizado" como proveedor
3. Ingresa la **URL del Endpoint** del proveedor (ej: `https://api.together.xyz/v1/chat/completions`)
4. Ingresa el nombre del modelo según la documentación del proveedor

---

## 4. Escribir el System Prompt

El **System Prompt** es lo más importante. Es la "personalidad" e instrucciones de tu agente. Aquí hay una plantilla que puedes adaptar:

### Plantilla Básica (copia y personaliza):

```
Eres un agente de atención al cliente amable y profesional de [NOMBRE DE TU EMPRESA].

SOBRE LA EMPRESA:
- [Describe brevemente qué hace tu empresa]
- [Productos o servicios principales]
- [Horario de atención: lunes a viernes de 9am a 6pm]

TU OBJETIVO:
- Responder preguntas sobre nuestros productos y servicios
- Ayudar a los clientes con cotizaciones
- Resolver dudas comunes
- Si no puedes resolver algo, indica que un agente humano tomará la conversación

REGLAS IMPORTANTES:
- Siempre responde en español
- Sé amable pero conciso
- No inventes información que no tengas
- Si el cliente pregunta precios, consulta la base de datos
- Si el cliente quiere comprar, guíalo al proceso de pago
- Nunca compartas información confidencial de la empresa
- Si te hacen preguntas fuera de tu área, indica amablemente que solo puedes ayudar con [temas relevantes]

TONO: Profesional pero cercano, como un vendedor experimentado que quiere ayudar genuinamente.
```

### Consejos para un buen System Prompt:

- **Sé específico:** En lugar de "responde bien", di "responde en máximo 3 oraciones"
- **Define límites:** Especifica qué NO debe hacer el agente
- **Incluye contexto:** Información sobre tu empresa, productos, políticas
- **Define el tono:** Formal, informal, técnico, amigable
- **Incluye ejemplos:** Si quieres respuestas en un formato específico

---

## 5. Subir una Base de Datos desde Excel

Esta función te permite subir un archivo Excel para que tu agente pueda consultar información real de tus productos, precios, inventario, etc.

### Preparar tu archivo Excel:

1. Abre tu archivo Excel (.xlsx, .xls o .csv)
2. Asegúrate de que:
   - La **primera fila** tenga los **nombres de las columnas** (encabezados)
   - No haya filas vacías al inicio
   - Los datos estén limpios (sin celdas combinadas)
   - El archivo pese menos de 5MB

**Ejemplo de estructura correcta:**

| Producto | Precio | Categoría | Disponible | Descripción |
|----------|--------|-----------|------------|-------------|
| Laptop HP 15 | 12999 | Computadoras | Sí | Laptop con Intel i5, 8GB RAM |
| Mouse Logitech | 399 | Accesorios | Sí | Mouse inalámbrico ergonómico |
| Monitor Samsung | 4599 | Monitores | No | Monitor 24" Full HD |

### Subir el archivo:

1. Ve a la página **"Agentes IA"**
2. En la sección **"Bases de Datos / Conocimiento"**, haz clic en **"+ Subir Excel"**
3. Arrastra tu archivo o haz clic para seleccionarlo
4. Revisa la **vista previa** de los datos
5. Dale un **nombre** descriptivo (ej: "Catálogo de Productos")
6. Opcionalmente agrega una **descripción**
7. Haz clic en **"Importar a Base de Datos"**
8. Espera a que termine la importación

### Para actualizar datos:

Si tus precios o inventario cambian:
1. Haz clic en **"Actualizar"** en la tarjeta de la base de datos
2. Sube el nuevo archivo Excel
3. Los datos anteriores se reemplazarán con los nuevos

---

## 6. Vincular Base de Datos con el Agente

Para que tu agente pueda consultar una base de datos:

1. Ve a **"Agentes IA"**
2. Haz clic en **"Editar"** en tu agente
3. En la sección **"Bases de datos asignadas"**, marca las bases de datos que quieres que pueda consultar
4. Haz clic en **"Guardar Agente"**

Puedes asignar **múltiples bases de datos** al mismo agente. Por ejemplo:
- Base de datos de "Productos" (catálogo completo)
- Base de datos de "Preguntas Frecuentes" (FAQ)
- Base de datos de "Sucursales" (ubicaciones y horarios)

---

## 7. Asignar Agentes a Canales

Puedes tener **diferentes agentes para diferentes canales**, o **un solo agente para todos**:

### Un agente para todos los canales:
1. Al crear/editar el agente, marca los tres canales: WhatsApp, Instagram, Messenger

### Diferentes agentes por canal:
1. Crea un agente especializado para cada canal
2. En cada agente, marca solo el canal correspondiente

**Ejemplo:**
- "Agente de Ventas WhatsApp" → Solo WhatsApp
- "Agente de Soporte Instagram" → Solo Instagram
- "Agente General" → Messenger

### Ver el Mapa de Canales:
En la parte inferior de la página "Agentes IA" hay un **Mapa de Canales** que te muestra visualmente qué agente atiende cada canal.

---

## 8. Activar la IA en una Conversación

La IA se puede activar o desactivar **por conversación individual**:

1. Abre una **conversación** desde la página de Conversaciones
2. En la parte superior del chat, verás un **switch con un ícono de robot (🤖)**
3. **Activa el switch** para que la IA atienda esa conversación
4. **Desactiva el switch** si quieres atender manualmente

Cuando la IA está activada:
- Los mensajes del cliente serán procesados automáticamente por el agente asignado al canal
- El agente usará su System Prompt y las bases de datos vinculadas para responder
- Puedes intervenir en cualquier momento desactivando el switch

---

## 9. Configurar Firebase Cloud Functions

Para que la IA funcione en producción, necesitas configurar Firebase Cloud Functions. Esto requiere asistencia técnica.

### Qué necesita tu desarrollador:

1. **Plan Firebase Blaze** activado en tu proyecto
2. **Instalar Firebase CLI:** `npm install -g firebase-tools`
3. **Inicializar Functions:** `firebase init functions` en la carpeta del proyecto
4. **Crear la Cloud Function** que:
   - Escuche nuevos mensajes en Firestore (`onSnapshot` en la colección de mensajes)
   - Verifique si la conversación tiene `aiEnabled: true`
   - Identifique qué agente atiende el canal de la conversación
   - Construya el prompt enriquecido con datos de las bases de datos
   - Llame a la API del proveedor de IA (OpenAI/Anthropic)
   - Guarde la respuesta como nuevo mensaje en la conversación

### Estructura de datos en Firestore:

```
organizations/{orgId}/aiAgents/{agentId}
  ├── name: "Agente de Ventas"
  ├── provider: "openai"
  ├── model: "gpt-4o"
  ├── apiKey: "sk-..."
  ├── systemPrompt: "Eres un agente..."
  ├── channels: { whatsapp: true, instagram: false, messenger: true }
  ├── knowledgeBases: ["kbId1", "kbId2"]
  └── isActive: true

organizations/{orgId}/knowledgeBases/{kbId}
  ├── name: "Catálogo de Productos"
  ├── columns: ["Producto", "Precio", "Categoría"]
  ├── rowCount: 150
  └── rows/ (subcolección)
      ├── {rowId}: { Producto: "Laptop", Precio: 12999, ... }
      └── ...

organizations/{orgId}/conversations/{convId}
  ├── aiEnabled: true/false
  ├── contactName: "Juan"
  ├── platform: "whatsapp"
  └── messages/ (subcolección)
      └── ...
```

### Funciones ya preparadas en el código:

El archivo `app.js` ya incluye estas funciones que tu desarrollador puede reutilizar:

- `buildAISystemPrompt(agent)` — Genera el prompt enriquecido con el esquema de las bases de datos
- `buildAIToolDefinitions(agent)` — Genera las definiciones de herramientas (function calling) para la IA
- `queryKnowledgeBase(kbId, searchQuery, filters, limit)` — Ejecuta consultas a las bases de datos

---

## 10. Solución de Problemas

### "No veo la opción de Agentes IA"
- Solo los **Gerentes** pueden ver esta sección. Los agentes no tienen acceso.

### "Mi agente no responde"
1. Verifica que el agente esté **activo** (switch verde en la tarjeta del agente)
2. Verifica que el agente esté **asignado al canal** correcto
3. Verifica que la conversación tenga el **switch de IA activado** (🤖)
4. Verifica que la **API Key** sea válida y tenga crédito
5. Revisa la consola de Firebase Functions para errores

### "La API Key no funciona"
- Verifica que copiaste la clave completa (sin espacios)
- Verifica que la clave tenga crédito/saldo disponible
- Para OpenAI: verifica en [platform.openai.com/usage](https://platform.openai.com/usage)
- Para Anthropic: verifica en [console.anthropic.com](https://console.anthropic.com)

### "Los datos del Excel no se importaron bien"
- La primera fila DEBE ser los encabezados/nombres de columna
- No uses celdas combinadas
- Evita caracteres especiales en los nombres de columnas
- El archivo debe pesar menos de 5MB
- Formatos soportados: .xlsx, .xls, .csv

### "El agente da respuestas incorrectas"
- Revisa y mejora tu **System Prompt** (sección 4)
- Verifica que la **base de datos** tenga la información correcta
- Prueba con un modelo más avanzado (GPT-4o o Claude Sonnet 4.5)
- Agrega más contexto y ejemplos al System Prompt

### "Quiero que el agente deje de responder en una conversación"
- Abre la conversación y **desactiva el switch de IA** (🤖) en la parte superior

---

## Resumen Rápido

| Paso | Acción | Dónde |
|------|--------|-------|
| 1 | Obtener API Key | OpenAI o Anthropic |
| 2 | Crear Agente | Agentes IA > + Crear Agente |
| 3 | Subir Excel | Agentes IA > + Subir Excel |
| 4 | Vincular datos | Editar Agente > Bases de datos |
| 5 | Asignar canales | Editar Agente > Canales |
| 6 | Activar IA | Conversación > Switch 🤖 |

---

*Documento generado para MessageHub. Para soporte técnico adicional, contacta a tu administrador o equipo de desarrollo.*
