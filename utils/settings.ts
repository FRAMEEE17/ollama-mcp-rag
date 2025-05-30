import { useStorage } from '@vueuse/core'
import type { KnowledgeBase } from '@prisma/client'
import type { ContextKeys } from '~/server/middleware/keys'

// todo: only for compatibility with old localStorage values, will be removed in the future
function getLocalValue(key: string) {
  return process.server ? '' : (localStorage.getItem(key) || '')
}

export const DEFAULT_KEYS_STORE: ContextKeys = {
  ollama: {
    endpoint: getLocalValue('ollama.host'),
    username: getLocalValue('ollama.username'),
    password: getLocalValue('ollama.password'),
  },
  openai: {
    key: getLocalValue('keys.openai_api_key'),
    endpoint: getLocalValue('keys.openai_api_host'),
    proxy: false,
  },
  azureOpenai: {
    key: getLocalValue('keys.azure_openai_api_key'),
    endpoint: getLocalValue('keys.azure_openai_endpoint'),
    deploymentName: getLocalValue('keys.azure_openai_deployment_name'),
    proxy: false,
  },
  anthropic: {
    key: getLocalValue('keys.anthropic_api_key'),
    endpoint: getLocalValue('keys.anthropic_api_host'),
    proxy: false,
  },
  moonshot: {
    key: getLocalValue('keys.moonshot_api_key'),
    endpoint: getLocalValue('keys.moonshot_api_host'),
  },
  gemini: {
    key: getLocalValue('keys.gemini_api_key'),
    proxy: false,
    endpoint: '',
  },
  groq: {
    key: getLocalValue('keys.groq_api_key'),
    endpoint: getLocalValue('keys.groq_api_host'),
    proxy: false,
  },
  vllm: {
    endpoint: process.env.VLLM_ENDPOINT || 'http://localhost:8694/v1',
    key: process.env.VLLM_API_KEY || '',
    proxy: process.env.VLLM_PROXY === 'true'
  },
  nvidia: {
    key: process.env.NVIDIA_API_KEY || '',
    endpoint: process.env.NVIDIA_ENDPOINT || 'https://integrate.api.nvidia.com/v1',
    proxy: process.env.NVIDIA_PROXY === 'true'
  },
  custom: []
}

export const keysStore = useStorage<ContextKeys>('keys', DEFAULT_KEYS_STORE)

export const getKeysHeader = () => ({ 'x-chat-ollama-keys': encodeURIComponent(JSON.stringify(keysStore.value)) })

export const loadOllamaInstructions = async () => {
  try {
    const { instructions } = await $fetchWithAuth<Record<string, { id: number, name: string, instruction: string }[]>>(`/api/instruction/`)
    return instructions
  } catch (e) {
    console.error("Failed to fetch Ollama instructions", e)
    return []
  }
}

export async function loadKnowledgeBases() {
  const response = await $fetchWithAuth('/api/knowledgebases/').catch(() => null)
  return (response?.knowledgeBases || []) as KnowledgeBase[]
}
