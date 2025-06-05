import { OpenAIEmbeddings } from "@langchain/openai"
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { Embeddings } from "@langchain/core/embeddings"
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
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'

// Embedding model validation
export function isApiEmbeddingModelExists(embeddingModelName: string) {
  return [...OPENAI_EMBEDDING_MODELS, ...GEMINI_EMBEDDING_MODELS].includes(embeddingModelName)
}

export async function isOllamaModelExists(ollama: Ollama, embeddingModelName: string) {
  const res = await ollama.list()
  return res.models.some(model => model.name.includes(embeddingModelName))
}

// Enhanced embedding creation with better error handling
export const createEmbeddings = (embeddingModelName: string, event: H3Event): Embeddings => {
  const keys = event.context.keys
  
  try {
    if (OPENAI_EMBEDDING_MODELS.includes(embeddingModelName)) {
      console.log(`Creating embeddings for OpenAI model: ${embeddingModelName}`)
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
      console.log(`Creating embeddings for Ollama model: ${embeddingModelName}`)
      return new OllamaEmbeddings({
        model: embeddingModelName,
        baseUrl: keys.ollama.endpoint,
      })
    }
  } catch (error) {
    console.error(`Failed to create embeddings for ${embeddingModelName}:`, error)
    throw new Error(`Embedding model creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Ensure OpenAI API compatible endpoint format
 */
function openaiApiFillPath(endpoint: string) {
  if (endpoint && !/\/v\d$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\/+$/, '') + '/v1'
  }
  return endpoint
}

type InitChatParams = { 
  key: string
  endpoint: string
  proxy?: boolean
  deploymentName?: string 
}

/**
 * Enhanced NVIDIA model creation with comprehensive error handling
 * This addresses the specific NVIDIA API compatibility issues
 */
function createNvidiaModel(modelName: string, apiKey: string, endpoint: string): BaseChatModel {
  console.log(`[NVIDIA Model] Creating model: ${modelName} at ${endpoint}`)
  
  if (!apiKey || apiKey === 'test-key-for-structure-test') {
    throw new Error('Valid NVIDIA API key is required. Please configure your NVIDIA API key in settings.')
  }
  
  try {
    // Create OpenAI-compatible model for NVIDIA API
    const baseModel = new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint)
      },
      openAIApiKey: apiKey,
      modelName: modelName,
      // Critical NVIDIA API optimizations
      streamUsage: false,           // Prevents stream_options errors
      temperature: 0.7,
      maxTokens: 2048,
      maxRetries: 2,                // Limit retries to avoid cascading failures
      timeout: 60000,               // 60 second timeout
      // Remove streaming by default - let handler control it
      streaming: false
    })

    // Create a proxy wrapper to handle NVIDIA-specific message formatting
    return new Proxy(baseModel, {
      get(target, prop, receiver) {
        const originalMethod = Reflect.get(target, prop, receiver)
        
        // Intercept invoke and stream methods for message format fixing
        if (prop === 'invoke' || prop === 'stream') {
          return async function(input: any, options?: any) {
            try {
              // Fix message format before sending to NVIDIA API
              const fixedInput = fixNvidiaMessageFormat(input)
              console.log(`[NVIDIA Model] ${prop} with ${Array.isArray(fixedInput) ? fixedInput.length : 1} messages`)
              
              return await originalMethod.call(target, fixedInput, options)
              
            } catch (error) {
              console.error(`[NVIDIA Model] ${prop} error:`, error)
              
              // Handle specific NVIDIA API errors
              if (error instanceof Error) {
                if (error.message.includes('stream_options')) {
                  console.log('[NVIDIA Model] Retrying without streaming options...')
                  // Create a clean model instance for retry
                  const retryModel = new ChatOpenAI({
                    configuration: { baseURL: openaiApiFillPath(endpoint) },
                    openAIApiKey: apiKey,
                    modelName: modelName,
                    streamUsage: false,
                    temperature: 0.7,
                    maxTokens: 2048,
                    streaming: false
                  })
                  
                  const fixedInput = fixNvidiaMessageFormat(input)
                  const retryMethod = retryModel[prop as keyof typeof retryModel]
                  if (typeof retryMethod === 'function') {
                    return await (retryMethod as Function).apply(retryModel, [fixedInput, options])
                  }
                }
                
                if (error.message.includes('API key')) {
                  throw new Error('Invalid NVIDIA API key. Please check your API key in settings.')
                }
                
                if (error.message.includes('model')) {
                  throw new Error(`Model "${modelName}" not available. Please check the model name.`)
                }
              }
              
              throw error
            }
          }
        }
        
        return originalMethod
      }
    }) as BaseChatModel
    
  } catch (error) {
    console.error('[NVIDIA Model] Creation failed:', error)
    throw new Error(`Failed to create NVIDIA model: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Enhanced VLLM model creation with connection testing
 */
function createVLLMModel(modelName: string, apiKey: string, endpoint: string): BaseChatModel {
  console.log(`[VLLM Model] Creating model: ${modelName} at ${endpoint}`)
  
  try {
    // Test VLLM connection first (fire and forget)
    testVLLMConnection(endpoint).catch(error => {
      console.warn(`[VLLM] Connection test failed: ${error.message}`)
    })
    
    const model = new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint)
      },
      openAIApiKey: apiKey || 'EMPTY',  // VLLM often uses 'EMPTY' for local
      modelName: modelName,
      temperature: 0.7,
      maxTokens: 2048,
      maxRetries: 1,                    // Lower retries for local server
      timeout: 30000,                   // Shorter timeout for local
      streaming: false
    })
    
    return model as BaseChatModel
    
  } catch (error) {
    console.error('[VLLM Model] Creation failed:', error)
    throw new Error(`Failed to create VLLM model: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Test VLLM server connection
 */
async function testVLLMConnection(endpoint: string): Promise<void> {
  try {
    console.log(`[VLLM] Testing connection to ${endpoint}`)
    
    const response = await fetch(`${endpoint}/models`, {
      signal: AbortSignal.timeout(5000)
    })
    
    if (!response.ok) {
      throw new Error(`VLLM server returned ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`[VLLM] Connection successful - found ${data.data?.length || 0} models`)
    
  } catch (error) {
    throw new Error(`VLLM server not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * message format fixing for NVIDIA API compatibility
 * This handles all the problematic message formats identified in testing
 */
function fixNvidiaMessageFormat(input: any): BaseMessage[] {
  console.log('[NVIDIA Fix] Processing input type:', typeof input, 'isArray:', Array.isArray(input))
  
  let messages: any[] = []

  // Handle different input formats
  if (Array.isArray(input)) {
    messages = input
  } else if (input && typeof input === 'object') {
    // Handle malformed object format like { "0": "user", "1": "content" }
    if (typeof input["0"] === 'string' && typeof input["1"] === 'string') {
      console.log('[NVIDIA Fix] Converting malformed object to proper message format')
      messages = [{
        role: input["0"],
        content: input["1"]
      }]
    } else if (input.role && input.hasOwnProperty('content')) {
      // Handle single message object
      messages = [input]
    } else if (input._getType && typeof input._getType === 'function') {
      // Handle LangChain message objects
      const type = input._getType()
      const role = type === 'human' ? 'user' : 
                   type === 'ai' ? 'assistant' : 
                   type === 'system' ? 'system' : 'user'
      messages = [{ role, content: input.content || '' }]
    } else {
      console.warn('[NVIDIA Fix] Unknown object format, attempting conversion')
      messages = [{ role: 'user', content: JSON.stringify(input) }]
    }
  } else if (typeof input === 'string') {
    // Handle plain string input
    messages = [{ role: 'user', content: input }]
  } else {
    console.error('[NVIDIA Fix] Unknown input format:', input)
    messages = [{ role: 'user', content: String(input) }]
  }

  // Convert to LangChain BaseMessage objects
  const langChainMessages: BaseMessage[] = []
  let lastRole: string | null = null

  for (const message of messages) {
    let currentRole = message.role
    let content = message.content

    // Normalize role names
    if (currentRole === 'human') currentRole = 'user'
    if (currentRole === 'ai') currentRole = 'assistant'

    // Handle missing role
    if (!currentRole) {
      console.log('[NVIDIA Fix] Warning: message without role, defaulting to user')
      currentRole = 'user'
    }
    
    // Handle missing/invalid content
    if (content === undefined || content === null) {
      console.log('[NVIDIA Fix] Warning: message without content, using empty string')
      content = ''
    }

    // Convert content to string if it's not already
    if (typeof content !== 'string') {
      if (Array.isArray(content)) {
        // Handle multimodal content - extract text parts
        content = content
          .filter(part => part && part.type === 'text')
          .map(part => part.text || '')
          .join(' ')
      } else {
        content = String(content)
      }
    }

    // Skip consecutive messages with same role (except system)
    if (currentRole === lastRole && currentRole !== 'system') {
      console.log(`[NVIDIA Fix] Skipping duplicate ${currentRole} message`)
      continue
    }

    // Skip empty messages (except system)
    if (!content.trim() && currentRole !== 'system') {
      console.log(`[NVIDIA Fix] Skipping empty ${currentRole} message`)
      continue
    }

    // Create appropriate LangChain message object
    let langChainMessage: BaseMessage
    
    switch (currentRole) {
      case 'system':
        langChainMessage = new SystemMessage(content.trim())
        break
      case 'assistant':
        langChainMessage = new AIMessage(content.trim())
        break
      case 'user':
      default:
        langChainMessage = new HumanMessage(content.trim())
        break
    }

    langChainMessages.push(langChainMessage)
    lastRole = currentRole
  }

  // Ensure we have at least one message
  if (langChainMessages.length === 0) {
    console.log('[NVIDIA Fix] No valid messages found, adding default')
    langChainMessages.push(new HumanMessage('Please respond.'))
  }

  console.log(`[NVIDIA Fix] Final: ${messages.length} → ${langChainMessages.length} messages`)
  return langChainMessages
}

/**
 * Core chat model creation function with enhanced family support
 */
function initChat(family: string, modelName: string, params: InitChatParams, isCustomModel = false): BaseChatModel | null {
  console.log(`Creating chat model [${family}/${modelName}]${params.endpoint ? ` at ${params.endpoint}` : ''}`)
  
  const endpoint = getProxyEndpoint(params.endpoint, params?.proxy || false)

  try {
    // OpenAI models
    if (family === MODEL_FAMILIES.openai || isCustomModel) {
      const baseURL = openaiApiFillPath(endpoint)
      return new ChatOpenAI({
        configuration: { baseURL },
        openAIApiKey: params.key,
        modelName: modelName,
      }) as BaseChatModel
    }

    // Azure OpenAI models
    if (family === MODEL_FAMILIES.azureOpenai && (isCustomModel || AZURE_OPENAI_GPT_MODELS.includes(modelName))) {
      return new AzureChatOpenAI({
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiKey: params.key,
        azureOpenAIApiDeploymentName: params.deploymentName,
        modelName: modelName,
      }) as unknown as BaseChatModel
    }

    // Anthropic models
    if (family === MODEL_FAMILIES.anthropic && (isCustomModel || ANTHROPIC_MODELS.includes(modelName))) {
      return new ChatAnthropic({
        anthropicApiUrl: endpoint,
        anthropicApiKey: params.key,
        modelName: modelName,
      }) as unknown as BaseChatModel
    }

    // Google Gemini models
    if (family === MODEL_FAMILIES.gemini && (isCustomModel || GEMINI_MODELS.includes(modelName))) {
      return new ChatGoogleGenerativeAI({
        apiVersion: "v1beta",
        apiKey: params.key,
        modelName: modelName,
        baseUrl: endpoint,
      }) as unknown as BaseChatModel
    }

    // Groq models
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

    return null

  } catch (error) {
    console.error(`Failed to create ${family} model:`, error)
    throw new Error(`Model creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Main chat model creation function with comprehensive error handling
 */
export const createChatModel = (modelName: string, family: string, event: H3Event): BaseChatModel => {
  const keys = event.context.keys
  
  console.log(`[createChatModel] Creating ${family}/${modelName}`)
  
  // Validate inputs
  if (!modelName || !family) {
    throw new Error('Model name and family are required')
  }
  
  const normalizedFamily = family.toLowerCase()
  
  try {
    // Handle NVIDIA API with enhanced error handling
    if (normalizedFamily === 'nvidia') {
      console.log(`[createChatModel] Creating NVIDIA model`)
      
      if (!keys?.nvidia?.key) {
        throw new Error('NVIDIA API key not configured. Please set your NVIDIA API key in settings.')
      }
      
      const endpoint = keys.nvidia.endpoint || 'https://integrate.api.nvidia.com/v1'
      return createNvidiaModel(modelName, keys.nvidia.key, endpoint)
    }

    // Handle VLLM with improved connection handling  
    if (normalizedFamily === 'vllm') {
      console.log(`[createChatModel] Creating VLLM model`)
      
      const endpoint = keys.vllm?.endpoint || 'http://localhost:8694/v1'
      const apiKey = keys.vllm?.key || 'EMPTY'
      
      return createVLLMModel(modelName, apiKey, endpoint)
    }
    
    // Handle other model families using existing logic
    const familyKey = Object.keys(MODEL_FAMILIES).find(key => 
      MODEL_FAMILIES[key as keyof typeof MODEL_FAMILIES] === normalizedFamily
    )

    if (familyKey && !['nvidia', 'vllm'].includes(familyKey)) {
      const data = keys[familyKey as Exclude<keyof ContextKeys, 'ollama' | 'custom' | 'nvidia' | 'vllm'>]
      if (data) {
        const model = initChat(normalizedFamily, modelName, data)
        if (model) return model as BaseChatModel
      }
    }

    // Check custom models
    const customModel = keys.custom?.find(el => el.name === normalizedFamily)
    if (customModel && MODEL_FAMILIES.hasOwnProperty(customModel.aiType)) {
      const model = initChat(MODEL_FAMILIES[customModel.aiType as keyof typeof MODEL_FAMILIES], modelName, customModel, true)
      if (model) return model as BaseChatModel
    }

    // Fall back to Ollama if family is explicitly 'ollama' or empty
    if (!family || normalizedFamily === 'ollama') {
      console.log("Creating Ollama model at:", keys.ollama.endpoint)
      return new ChatOllama({
        baseUrl: keys.ollama.endpoint,
        model: modelName,
        numPredict: 3000
      })
    }

    throw new Error(`Unsupported model family: ${family}. Available families: ${Object.keys(MODEL_FAMILIES).join(', ')}, nvidia, vllm`)

  } catch (error) {
    console.error(`[createChatModel] Failed to create ${family}/${modelName}:`, error)
    
    // Provide helpful error messages based on the family
    if (normalizedFamily === 'nvidia') {
      if (error instanceof Error && error.message.includes('API key')) {
        throw new Error('NVIDIA API key is invalid or not set. Please configure a valid NVIDIA API key in settings.')
      }
      throw new Error(`NVIDIA model creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    
    if (normalizedFamily === 'vllm') {
      throw new Error(`VLLM model creation failed: ${error instanceof Error ? error.message : 'Check if VLLM server is running and accessible'}`)
    }
    
    throw error
  }
}

/**
 * Get proxy endpoint with enhanced validation
 */
function getProxyEndpoint(endpoint: string, useProxy: boolean) {
  const config = useRuntimeConfig()
  const port = process.env.PORT || 3000
  
  if (useProxy && endpoint && config.public.modelProxyEnabled && config.modelProxyUrl) {
    console.log('Using proxy:', endpoint, '->', config.modelProxyUrl)

    const link = `http://${process.env.HOST || 'localhost'}:${port}/api/proxy?token=${proxyTokenGenerate()}&endpoint=${endpoint}`
    return link
  }
  
  return endpoint ?? undefined
}