// server/utils/models.ts - FIXED VERSION
import { Embeddings } from "@langchain/core/embeddings"
import { OpenAIEmbeddings } from "@langchain/openai"
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama"
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from "~/server/models/genai/generative-ai"
import { ChatGroq } from "@langchain/groq"
import { AzureChatOpenAI } from "@langchain/azure-openai"
import { type H3Event } from 'h3'
import { type Ollama } from 'ollama'
import { proxyTokenGenerate } from '~/server/utils/proxyToken'
import { ANTHROPIC_MODELS, AZURE_OPENAI_GPT_MODELS, GEMINI_EMBEDDING_MODELS, GEMINI_MODELS, GROQ_MODELS, MODEL_FAMILIES, MOONSHOT_MODELS, OPENAI_EMBEDDING_MODELS, NVIDIA_MODELS, VLLM_MODELS } from '~/config/index'
import type { ContextKeys } from '~/server/middleware/keys'

export function isApiEmbeddingModelExists(embeddingModelName: string) {
  return [...OPENAI_EMBEDDING_MODELS, ...GEMINI_EMBEDDING_MODELS].includes(embeddingModelName)
}

export async function isOllamaModelExists(ollama: Ollama, embeddingModelName: string) {
  const res = await ollama.list()
  return res.models.some(model => model.name.includes(embeddingModelName))
}

export const createEmbeddings = (embeddingModelName: string, event: H3Event): Embeddings => {
  const keys = event.context.keys
  if (OPENAI_EMBEDDING_MODELS.includes(embeddingModelName)) {
    console.log(`Creating embeddings for OpenAI model: ${embeddingModelName}, host: ${keys.openai.endpoint}`)
    return new OpenAIEmbeddings({
      configuration: {
        baseURL: getProxyEndpoint(keys.openai.endpoint, keys.openai.proxy),
      },
      modelName: embeddingModelName,
      openAIApiKey: keys.openai.key,
    })
  } else if (GEMINI_EMBEDDING_MODELS.includes(embeddingModelName)) {
    console.log(`Creating embeddings for Gemini model: ${embeddingModelName}`)
    return new GoogleGenerativeAIEmbeddings({
      modelName: embeddingModelName,
      apiKey: keys.gemini.key,
    })
  } else {
    console.log(`Creating embeddings for Ollama served model: ${embeddingModelName}`)
    return new OllamaEmbeddings({
      model: embeddingModelName,
      baseUrl: keys.ollama.endpoint,
    })
  }
}

function openaiApiFillPath(endpoint: string) {
  if (endpoint && !/\/v\d$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\/+$/, '') + '/v1'
  }
  return endpoint
}

type InitChatParams = { key: string, endpoint: string, proxy?: boolean, deploymentName?: string }

// Fix the function signature and return type
function initChat(family: string, modelName: string, params: InitChatParams, isCustomModel = false): BaseChatModel | null {
  console.log(`Chat with [${family} ${modelName}]`, params.endpoint ? `, Host: ${params.endpoint}` : '')
  let endpoint = getProxyEndpoint(params.endpoint, params?.proxy || false)

  if (family === MODEL_FAMILIES.openai || isCustomModel) {
    const baseURL = openaiApiFillPath(endpoint)
    return new ChatOpenAI({
      configuration: { baseURL },
      openAIApiKey: params.key,
      modelName: modelName,
    }) as BaseChatModel
  }

// Fix for AzureChatOpenAI
  if (family === MODEL_FAMILIES.azureOpenai && (isCustomModel || AZURE_OPENAI_GPT_MODELS.includes(modelName))) {
    return new AzureChatOpenAI({
      azureOpenAIEndpoint: endpoint,
      azureOpenAIApiKey: params.key,
      azureOpenAIApiDeploymentName: params.deploymentName,
      modelName: modelName,
    }) as unknown as BaseChatModel  // Use 'as unknown as' for complex types
  }

  // Fix for ChatAnthropic
  if (family === MODEL_FAMILIES.anthropic && (isCustomModel || ANTHROPIC_MODELS.includes(modelName))) {
    return new ChatAnthropic({
      anthropicApiUrl: endpoint,
      anthropicApiKey: params.key,
      modelName: modelName,
    }) as unknown as BaseChatModel
  }

  // Fix for ChatGoogleGenerativeAI
  if (family === MODEL_FAMILIES.gemini && (isCustomModel || GEMINI_MODELS.includes(modelName))) {
    return new ChatGoogleGenerativeAI({
      apiVersion: "v1beta",
      apiKey: params.key,
      modelName: modelName,
      baseUrl: endpoint,
    }) as unknown as BaseChatModel
  }

  // Fix for ChatGroq
  if (family === MODEL_FAMILIES.groq && (isCustomModel || GROQ_MODELS.includes(modelName))) {
    if (params.endpoint) {
      process.env.GROQ_BASE_URL = getProxyEndpoint(params.endpoint, params?.proxy || false)
    }
    return new ChatGroq({
      apiKey: params.key,
      verbose: true,
      modelName: modelName,
    }) as unknown as BaseChatModel
  }

  // **FIX: Add NVIDIA support**
  if (family === MODEL_FAMILIES.nvidia) {
    return new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint) 
      },
      openAIApiKey: params.key,
      modelName: modelName,
    }) as BaseChatModel
  }

  // **FIX: Add VLLM support** 
  if (family === MODEL_FAMILIES.vllm) {
    return new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint) 
      },
      openAIApiKey: params.key || 'EMPTY', // VLLM often doesn't need a key
      modelName: modelName,
    }) as BaseChatModel
  }

  return null
}

export const createChatModel = (modelName: string, family: string, event: H3Event): BaseChatModel => {
  const keys = event.context.keys
  
  console.log(`[createChatModel] Creating model: ${modelName}, family: ${family}`)
  console.log(`[createChatModel] Available keys:`, Object.keys(keys))
  
  // **FIX: Handle NVIDIA explicitly**
  if (family === MODEL_FAMILIES.nvidia) {
    console.log(`[createChatModel] Creating NVIDIA model with key: ${keys.nvidia?.key ? 'SET' : 'NOT SET'}`)
    if (!keys.nvidia?.key) {
      throw new Error('NVIDIA API key not configured. Please set your NVIDIA API key in settings.')
    }
    
    const model = initChat(family, modelName, {
      key: keys.nvidia.key,
      endpoint: keys.nvidia.endpoint || 'https://integrate.api.nvidia.com/v1',
      proxy: keys.nvidia.proxy || false
    })
    
    if (!model) {
      throw new Error(`Failed to create NVIDIA model: ${modelName}`)
    }
    
    return model
  }

  // **FIX: Handle VLLM explicitly**
  if (family === MODEL_FAMILIES.vllm) {
    console.log(`[createChatModel] Creating VLLM model with endpoint: ${keys.vllm?.endpoint}`)
    
    const model = initChat(family, modelName, {
      key: keys.vllm?.key || 'EMPTY',
      endpoint: keys.vllm?.endpoint || 'http://localhost:8694/v1',
      proxy: keys.vllm?.proxy || false
    })
    
    if (!model) {
      throw new Error(`Failed to create VLLM model: ${modelName}`)
    }
    
    return model
  }

  // Handle other model families
  const [familyValue] = Object.entries(MODEL_FAMILIES).find(([key, val]) => val === family) || []

  if (familyValue && familyValue !== 'nvidia' && familyValue !== 'vllm') {
    const data = keys[familyValue as Exclude<keyof ContextKeys, 'ollama' | 'custom' | 'nvidia' | 'vllm'>]
    const model = initChat(family, modelName, data)
    if (model) return model as BaseChatModel
  }

  // Check custom models
  const customModel = keys.custom.find(el => el.name === family)
  if (customModel && MODEL_FAMILIES.hasOwnProperty(customModel.aiType)) {
    const model = initChat(MODEL_FAMILIES[customModel.aiType as keyof typeof MODEL_FAMILIES], modelName, customModel, true)
    if (model) return model as BaseChatModel
  }

  // **FIX: Only fall back to Ollama if family is explicitly 'ollama' or empty**
  if (!family || family === 'ollama') {
    console.log("Chat with Ollama, Host:", keys.ollama.endpoint)
    return new ChatOllama({
      baseUrl: keys.ollama.endpoint,
      model: modelName,
      numPredict: 3000
    })
  }

  // **FIX: Throw error instead of falling back to Ollama**
  throw new Error(`Unsupported model family: ${family}. Available families: ${Object.values(MODEL_FAMILIES).join(', ')}`)
}

function getProxyEndpoint(endpoint: string, useProxy: boolean) {
  const config = useRuntimeConfig()
  const port = process.env.PORT || 3000
  if (useProxy && endpoint && config.public.modelProxyEnabled && config.modelProxyUrl) {
    console.log('Proxy:', endpoint, '->', config.modelProxyUrl)

    const link = `http://${process.env.HOST || 'localhost'}:${port}/api/proxy?token=${proxyTokenGenerate()}&endpoint=${endpoint}`
    return link
  }
  return endpoint ?? undefined
}