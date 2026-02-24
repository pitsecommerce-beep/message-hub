/**
 * evolution-api.ts
 *
 * Thin HTTP client for Evolution API (v2).
 * All calls go directly from the browser to the user-supplied Evolution API server.
 * The server must have CORS enabled (default in Evolution API).
 *
 * Docs: https://doc.evolution-api.com
 */
import axios from 'axios'

// ─── Response types ────────────────────────────────────────────────────────────

export interface EvolutionInstance {
  instanceName: string
  instanceId: string
  status: string
  integration: string
}

export interface EvolutionCreateResponse {
  instance: EvolutionInstance
  hash: { apikey: string }
  qrcode?: { code: string; base64: string }
}

export interface EvolutionQRResponse {
  pairingCode: string | null
  /** Base64-encoded PNG or SVG – render directly in <img src={code} /> */
  code: string
  count: number
}

export interface EvolutionConnectionState {
  instance: {
    instanceName: string
    state: 'open' | 'connecting' | 'close' | 'refused'
  }
}

export interface EvolutionWebhookSetResponse {
  webhook: { instanceName: string; webhook: { enabled: boolean; url: string } }
}

// ─── Client factory ────────────────────────────────────────────────────────────

export function createEvolutionClient(baseUrl: string, apiKey: string) {
  const http = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    timeout: 20_000,
  })

  return {
    /**
     * Create a new Baileys instance.
     * Returns 409 if the instance already exists – callers should catch and continue.
     */
    async createInstance(instanceName: string): Promise<EvolutionCreateResponse> {
      const { data } = await http.post<EvolutionCreateResponse>('/instance/create', {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      })
      return data
    },

    /**
     * Fetch the current QR code for an instance.
     * Call this immediately after createInstance and then every ~10 s until connected.
     */
    async getQR(instanceName: string): Promise<EvolutionQRResponse> {
      const { data } = await http.get<EvolutionQRResponse>(
        `/instance/connect/${instanceName}`,
      )
      return data
    },

    /** Get the current Baileys connection state. */
    async getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
      const { data } = await http.get<EvolutionConnectionState>(
        `/instance/connectionState/${instanceName}`,
      )
      return data
    },

    /**
     * Configure the webhook so that incoming WhatsApp messages are forwarded
     * to the MessageHub Cloud Function endpoint.
     */
    async setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
      await http.post(`/webhook/set/${instanceName}`, {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT'],
        },
      })
    },

    /** Disconnect the WhatsApp session (keeps the instance, just logs out). */
    async logout(instanceName: string): Promise<void> {
      await http.delete(`/instance/logout/${instanceName}`)
    },

    /** Permanently delete the instance from the Evolution API server. */
    async deleteInstance(instanceName: string): Promise<void> {
      await http.delete(`/instance/delete/${instanceName}`)
    },
  }
}
