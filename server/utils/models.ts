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

// **FIXED: Helper function to properly handle message format for NVIDIA API**
function fixNvidiaMessageFormat(input: any): any[] {
  console.log('[NVIDIA] Input type:', typeof input, 'isArray:', Array.isArray(input));
  console.log('[NVIDIA] Input:', JSON.stringify(input, null, 2));

  // Handle different input formats
  let messages: any[] = [];

  if (Array.isArray(input)) {
    messages = input;
  } else if (typeof input === 'object' && input !== null) {
    // Handle the malformed object format like { "0": "user", "1": "content" }
    if (typeof input["0"] === 'string' && typeof input["1"] === 'string') {
      console.log('[NVIDIA] Converting malformed object to proper message format');
      messages = [{
        role: input["0"],
        content: input["1"]
      }];
    } else {
      // Handle single message object
      messages = [input];
    }
  } else if (typeof input === 'string') {
    // Handle plain string input
    messages = [{
      role: 'user',
      content: input
    }];
  } else {
    console.error('[NVIDIA] Unknown input format:', input);
    return [];
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
      console.log('[NVIDIA] Warning: message without role, defaulting to user');
      currentRole = 'user';
    }
    if (!content && content !== '') {
      console.log('[NVIDIA] Warning: message without content');
      content = '';
    }

    // Skip consecutive messages with same role (except system)
    if (currentRole === lastRole && currentRole !== 'system') {
      console.log(`[NVIDIA] Skipping duplicate ${currentRole} message`);
      continue;
    }

    // Create proper message format
    const properMessage = {
      role: currentRole,
      content: content
    };

    fixedMessages.push(properMessage);
    lastRole = currentRole;
  }

  console.log(`[NVIDIA] Fixed messages: ${messages.length} → ${fixedMessages.length}`);
  console.log(`[NVIDIA] Final messages:`, JSON.stringify(fixedMessages, null, 2));
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

export const createChatModel = (modelName: string, family: string, event: H3Event): BaseChatModel => {
  const keys = event.context.keys
  
  console.log(`[createChatModel] Creating model: ${modelName}, family: ${family}`)
  console.log(`[createChatModel] Available keys:`, Object.keys(keys))
  
  // **FIX: Normalize family names**
  if (family === 'NVIDIA') family = 'nvidia'
  if (family === 'VLLM') family = 'vllm'
  
  // **FIX: Handle NVIDIA with proper message format handling**
  if (family === 'nvidia') {
    console.log(`[createChatModel] Creating NVIDIA model with key: ${keys.nvidia?.key ? 'SET' : 'NOT SET'}`)
    if (!keys.nvidia?.key) {
      throw new Error('NVIDIA API key not configured. Please set your NVIDIA API key in settings.')
    }
    
    const baseModel = new ChatOpenAI({
      configuration: { 
        baseURL: openaiApiFillPath(keys.nvidia.endpoint || 'https://integrate.api.nvidia.com/v1')
      },
      openAIApiKey: keys.nvidia.key,
      modelName: modelName,
      // **CRITICAL FIXES for NVIDIA API**
      streamUsage: false,           // Prevents stream_options error
      temperature: 0.7,
      maxTokens: 2048,
    });

    // **Create a proper wrapper that handles message format issues**
    class NvidiaModelWrapper extends ChatOpenAI {
      constructor(config: any) {
        super(config);
      }

      async invoke(input: any, options?: any): Promise<any> {
        console.log('[NVIDIA Wrapper] invoke called with:', typeof input);
        const fixedMessages = fixNvidiaMessageFormat(input);
        return super.invoke(fixedMessages, options);
      }

      async stream(input: any, options?: any): Promise<any> {
        console.log('[NVIDIA Wrapper] stream called with:', typeof input);
        const fixedMessages = fixNvidiaMessageFormat(input);
        return super.stream(fixedMessages, options);
      }
    }

    const wrappedModel = new NvidiaModelWrapper({
      configuration: { 
        baseURL: openaiApiFillPath(keys.nvidia.endpoint || 'https://integrate.api.nvidia.com/v1')
      },
      openAIApiKey: keys.nvidia.key,
      modelName: modelName,
      streamUsage: false,
      temperature: 0.7,
      maxTokens: 2048,
    });

    return wrappedModel as BaseChatModel;
  }

  // **FIX: Handle VLLM with lowercase key**
  if (family === 'vllm') {
    console.log(`[createChatModel] Creating VLLM model with endpoint: ${keys.vllm?.endpoint}`)
    
    const model = initChat(MODEL_FAMILIES.vllm, modelName, {
      key: keys.vllm?.key || 'EMPTY',
      endpoint: keys.vllm?.endpoint || 'http://localhost:8694/v1',
      proxy: keys.vllm?.proxy || false
    })
    
    if (!model) {
      throw new Error(`Failed to create VLLM model: ${modelName}`)
    }
    
    return model
  }

  // Handle other model families using the existing logic
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

  // **FIX: Show available family keys in error message**
  const availableFamilies = [...Object.keys(MODEL_FAMILIES), 'nvidia', 'vllm'].join(', ')
  throw new Error(`Unsupported model family: ${family}. Available families: ${availableFamilies}`)
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