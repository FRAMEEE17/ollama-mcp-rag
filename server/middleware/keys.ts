export interface ContextKeys {
  ollama: {
    endpoint: string
    username: string
    password: string
  },
  openai: {
    key: string
    endpoint: string
    proxy: boolean
  },
  azureOpenai: {
    key: string
    endpoint: string
    deploymentName: string
    proxy: boolean
  },
  anthropic: {
    key: string
    endpoint: string
    proxy: boolean
  },
  moonshot: {
    key: string
    endpoint: string
  },
  gemini: {
    key: string
    endpoint: string
    proxy: boolean
  },
  groq: {
    key: string
    endpoint: string
    proxy: boolean
  },
  // VLLM & NVIDIA - exactly as you defined
  vllm: {
    endpoint: string
    key?: string
    proxy?: boolean
  }
  nvidia: {
    key: string
    endpoint?: string
    proxy?: boolean
  }
  custom: Array<{
    name: string
    aiType: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'azureOpenai' | 'vllm' | 'nvidia'
    endpoint: string
    key: string
    models: string[]
    modelsEndpoint?: string
    proxy?: boolean
  }>
}

function tryParseJSON(jsonString: string, defaultValue: any) {
  try {
    return JSON.parse(jsonString)
  } catch (e) {
    return defaultValue
  }
}

export default defineEventHandler(async (event) => {
  const headers = getRequestHeaders(event)
  const value = headers['x-chat-ollama-keys']
  const data = (value ? tryParseJSON(decodeURIComponent(value), {}) : {}) as ContextKeys

  event.context.keys = {
    ...data,
    ollama: {
      ...data.ollama,
      endpoint: (data.ollama?.endpoint || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    },
    openai: data.openai || { key: '', endpoint: 'https://api.openai.com/v1', proxy: false, models: [], modelsEndpoint: '' },
    azureOpenai: data.azureOpenai || { key: '', endpoint: '', deploymentName: '', proxy: false, models: [], modelsEndpoint: '' },
    anthropic: data.anthropic || { key: '', endpoint: 'https://api.anthropic.com', proxy: false, models: [], modelsEndpoint: '' },
    moonshot: data.moonshot || { key: '', endpoint: 'https://api.moonshot.cn/v1', models: [], modelsEndpoint: '' },
    gemini: data.gemini || { key: '', endpoint: 'https://generativelanguage.googleapis.com', proxy: false, models: [], modelsEndpoint: '' },
    groq: data.groq || { key: '', endpoint: 'https://api.groq.com/openai/v1', proxy: false, models: [], modelsEndpoint: '' },
    vllm: data.vllm || { endpoint: 'http://localhost:8694/v1', key: '', proxy: false, models: [], modelsEndpoint: '' },
    nvidia: data.nvidia || { key: '', endpoint: 'https://integrate.api.nvidia.com/v1', proxy: false, models: [], modelsEndpoint: '' },
    custom: data.custom || []
  }
})