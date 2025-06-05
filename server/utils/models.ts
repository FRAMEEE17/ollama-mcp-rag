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
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

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
/**
 * Enhanced NVIDIA model creation with proper message handling
 * This fixes the message format issues you were experiencing
 */
function createNvidiaModel(modelName: string, apiKey: string, endpoint: string): BaseChatModel {
  console.log(`[NVIDIA Model] Creating model: ${modelName}`)
  
  // Create base OpenAI-compatible model for NVIDIA API
  const baseModel = new ChatOpenAI({
    configuration: { 
      baseURL: openaiApiFillPath(endpoint)
    },
    openAIApiKey: apiKey,
    modelName: modelName,
    // Critical NVIDIA API fixes
    streamUsage: false,           // Prevents stream_options error
    temperature: 0.7,
    maxTokens: 2048,
    // Remove any conflicting parameters
    streaming: false              // Let the handler control streaming
  });

  // Wrap the model to handle NVIDIA-specific quirks
  return new Proxy(baseModel, {
    get(target, prop, receiver) {
      const originalMethod = Reflect.get(target, prop, receiver);
      
      // Intercept invoke and stream methods to fix message formatting
      if (prop === 'invoke' || prop === 'stream') {
        return async function(input: any, options?: any) {
          // Fix message format before sending to NVIDIA API
          const fixedInput = fixNvidiaMessageFormat(input);
          console.log(`[NVIDIA Model] ${prop} called with ${Array.isArray(fixedInput) ? fixedInput.length : 1} messages`);
          
          try {
            return await originalMethod.call(target, fixedInput, options);
          } catch (error) {
            console.error(`[NVIDIA Model] ${prop} error:`, error);
            
            // Handle specific NVIDIA API errors
            if (error instanceof Error) {
              if (error.message.includes('stream_options')) {
                console.log('[NVIDIA Model] Retrying without streaming options...');
                // Create a new model instance without streaming for this call
                const retryModel = new ChatOpenAI({
                  configuration: { baseURL: openaiApiFillPath(endpoint) },
                  openAIApiKey: apiKey,
                  modelName: modelName,
                  streamUsage: false,
                  temperature: 0.7,
                  maxTokens: 2048
                });
                const method = retryModel[prop as keyof typeof retryModel];
                if (typeof method === 'function') {
                  return await (method as Function).apply(retryModel, [fixedInput, options]);
                }
                throw new Error(`Method ${String(prop)} is not callable`);
              }
            }
            
            throw error;
          }
        };
      }
      
      return originalMethod;
    }
  }) as BaseChatModel;
}

/**
 * Enhanced message format fixing for NVIDIA API
 * This handles the various message format issues you encountered
 */
function fixNvidiaMessageFormat(input: any): any[] {
  console.log('[NVIDIA Fix] Input type:', typeof input, 'isArray:', Array.isArray(input));
  
  let messages: any[] = [];

  // Handle different input formats
  if (Array.isArray(input)) {
    messages = input;
  } else if (input && typeof input === 'object') {
    // Handle malformed object format like { "0": "user", "1": "content" }
    if (typeof input["0"] === 'string' && typeof input["1"] === 'string') {
      console.log('[NVIDIA Fix] Converting malformed object to proper message format');
      messages = [{
        role: input["0"],
        content: input["1"]
      }];
    } else if (input.role && input.content) {
      // Handle single message object
      messages = [input];
    } else {
      console.warn('[NVIDIA Fix] Unknown object format, attempting conversion');
      messages = [{ role: 'user', content: JSON.stringify(input) }];
    }
  } else if (typeof input === 'string') {
    // Handle plain string input
    messages = [{ role: 'user', content: input }];
  } else {
    console.error('[NVIDIA Fix] Unknown input format:', input);
    messages = [{ role: 'user', content: String(input) }];
  }

  const fixedMessages: any[] = [];
  let lastRole: string | null = null;

  for (const message of messages) {
    let currentRole = message.role;
    let content = message.content;

    // Handle LangChain message objects
    if (!currentRole && message._getType) {
      const type = message._getType();
      currentRole = type === 'human' ? 'user' : 
                   type === 'ai' ? 'assistant' : 
                   type === 'system' ? 'system' : 'user';
      content = message.content || message.text || '';
    }

    // Handle cases where role/content might be undefined
    if (!currentRole) {
      console.log('[NVIDIA Fix] Warning: message without role, defaulting to user');
      currentRole = 'user';
    }
    
    if (content === undefined || content === null) {
      console.log('[NVIDIA Fix] Warning: message without content, using empty string');
      content = '';
    }

    // Convert content to string if it's not already
    if (typeof content !== 'string') {
      if (Array.isArray(content)) {
        // Handle multimodal content - extract text parts
        content = content
          .filter(part => part.type === 'text')
          .map(part => part.text)
          .join(' ');
      } else {
        content = String(content);
      }
    }

    // Skip consecutive messages with same role (except system)
    if (currentRole === lastRole && currentRole !== 'system') {
      console.log(`[NVIDIA Fix] Skipping duplicate ${currentRole} message`);
      continue;
    }

    // Ensure content is not empty
    if (!content.trim() && currentRole !== 'system') {
      console.log(`[NVIDIA Fix] Skipping empty ${currentRole} message`);
      continue;
    }

    // Create proper message format for NVIDIA API
    const properMessage = {
      role: currentRole,
      content: content.trim()
    };

    fixedMessages.push(properMessage);
    lastRole = currentRole;
  }

  // Ensure we have at least one message
  if (fixedMessages.length === 0) {
    console.log('[NVIDIA Fix] No valid messages found, adding default');
    fixedMessages.push({
      role: 'user',
      content: 'Please respond.'
    });
  }

  console.log(`[NVIDIA Fix] Final messages: ${messages.length} → ${fixedMessages.length}`);
  return fixedMessages;
}

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
    }) as unknown as BaseChatModel
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

  // **FIX: Add NVIDIA support with proper API compatibility**
  if (family === MODEL_FAMILIES.nvidia) {
    return new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint) 
      },
      openAIApiKey: params.key,
      modelName: modelName,
      streamUsage: false,
    }) as BaseChatModel;
  }

  // **FIX: Add VLLM support** 
  if (family === MODEL_FAMILIES.vllm) {
    return new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint) 
      },
      openAIApiKey: params.key || 'EMPTY',
      modelName: modelName,
    }) as BaseChatModel
  }

  return null
}

/**
 * Updated createChatModel function with proper NVIDIA integration
 */
export const createChatModel = (modelName: string, family: string, event: H3Event): BaseChatModel => {
  const keys = event.context.keys
  
  console.log(`[createChatModel] Creating model: ${modelName}, family: ${family}`)
  
  // Normalize family names
  const normalizedFamily = family.toLowerCase()
  
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
    
    // Test VLLM connection before creating model
    testVLLMConnection(endpoint).catch(error => {
      console.warn(`[VLLM] Connection test failed: ${error.message}`)
    })
    
    const model = new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(endpoint)
      },
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: 0.7,
      maxTokens: 2048
    })
    
    return model as BaseChatModel
  }
  /**
 * Test VLLM server connection
 */
  async function testVLLMConnection(endpoint: string): Promise<void> {
    try {
      const response = await fetch(`${endpoint}/models`, {
        signal: AbortSignal.timeout(5000)
      })
      
      if (!response.ok) {
        throw new Error(`VLLM server returned ${response.status}`)
      }
      
      console.log('[VLLM] Connection test successful')
    } catch (error) {
      throw new Error(`VLLM server not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  // Handle other model families (keep existing logic)
  const [familyValue] = Object.entries(MODEL_FAMILIES).find(([key, val]) => val === normalizedFamily) || []

  if (familyValue && !['nvidia', 'vllm'].includes(familyValue)) {
    const data = keys[familyValue as Exclude<keyof ContextKeys, 'ollama' | 'custom' | 'nvidia' | 'vllm'>]
    const model = initChat(normalizedFamily, modelName, data)
    if (model) return model as BaseChatModel
  }

  // Check custom models
  const customModel = keys.custom.find(el => el.name === normalizedFamily)
  if (customModel && MODEL_FAMILIES.hasOwnProperty(customModel.aiType)) {
    const model = initChat(MODEL_FAMILIES[customModel.aiType as keyof typeof MODEL_FAMILIES], modelName, customModel, true)
    if (model) return model as BaseChatModel
  }

  // Fall back to Ollama only if family is explicitly 'ollama' or empty
  if (!family || normalizedFamily === 'ollama') {
    console.log("Creating Ollama model, Host:", keys.ollama.endpoint)
    return new ChatOllama({
      baseUrl: keys.ollama.endpoint,
      model: modelName,
      numPredict: 3000
    })
  }

  throw new Error(`Unsupported model family: ${family}. Available families: ${Object.keys(MODEL_FAMILIES).join(', ')}, nvidia, vllm`)
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