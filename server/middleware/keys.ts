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

  // **FIX: Merge environment variables with header data**
  event.context.keys = {
    ...data,
    ollama: {
      ...data.ollama,
      endpoint: (data.ollama?.endpoint || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    },
    openai: {
      key: data.openai?.key || process.env.OPENAI_API_KEY || '',
      endpoint: data.openai?.endpoint || 'https://api.openai.com/v1',
      proxy: data.openai?.proxy || false
    },
    azureOpenai: data.azureOpenai || { 
      key: process.env.AZURE_OPENAI_API_KEY || '', 
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '', 
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '', 
      proxy: false 
    },
    anthropic: {
      key: data.anthropic?.key || process.env.ANTHROPIC_API_KEY || '',
      endpoint: data.anthropic?.endpoint || 'https://api.anthropic.com',
      proxy: data.anthropic?.proxy || false
    },
    moonshot: data.moonshot || { 
      key: process.env.MOONSHOT_API_KEY || '', 
      endpoint: 'https://api.moonshot.cn/v1' 
    },
    gemini: {
      key: data.gemini?.key || process.env.GOOGLE_API_KEY || '',
      endpoint: data.gemini?.endpoint || 'https://generativelanguage.googleapis.com',
      proxy: data.gemini?.proxy || false
    },
    groq: {
      key: data.groq?.key || process.env.GROQ_API_KEY || '',
      endpoint: data.groq?.endpoint || 'https://api.groq.com/openai/v1',
      proxy: data.groq?.proxy || false
    },
    vllm: {
      endpoint: data.vllm?.endpoint || process.env.VLLM_ENDPOINT || 'http://localhost:8694/v1',
      key: data.vllm?.key || process.env.VLLM_API_KEY || '',
      proxy: data.vllm?.proxy || false
    },
    // **FIX: Add NVIDIA with environment variable fallback**
    nvidia: {
      key: data.nvidia?.key || process.env.NVIDIA_API_KEY || '',
      endpoint: data.nvidia?.endpoint || process.env.NVIDIA_ENDPOINT || 'https://integrate.api.nvidia.com/v1',
      proxy: data.nvidia?.proxy || false
    },
    custom: data.custom || []
  }
})