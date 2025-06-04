import { Readable } from 'stream'
import { formatDocumentsAsString } from "langchain/util/document"
import { PromptTemplate } from "@langchain/core/prompts"
import { RunnableSequence } from "@langchain/core/runnables"
// import { CohereRerank } from "@langchain/cohere"
import { CohereRerank } from "@/server/rerank/cohere"
import { setEventStreamResponse } from '@/server/utils'
import { BaseRetriever } from "@langchain/core/retrievers"
import prisma from "@/server/utils/prisma"
import { createChatModel, createEmbeddings } from '@/server/utils/models'
import { createRetriever } from '@/server/retriever'
import { AIMessage, AIMessageChunk, AIMessageFields, BaseMessage, BaseMessageChunk, BaseMessageLike, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { resolveCoreference } from '~/server/coref'
import { concat } from "@langchain/core/utils/stream"
import { MODEL_FAMILIES } from '~/config'
import { McpService } from '@/server/utils/mcp'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ChatOllama } from '@langchain/ollama'
import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

// Interface definitions for request/response structure
interface MessageContent {
  type: string
  text?: string
  image_url?: { url: string }
}

interface RequestBody {
  knowledgebaseId: number        // ID of knowledge base to query (optional)
  model: string                  // Model name (e.g., 'gpt-4', 'claude-3')
  family: string                 // Model family (e.g., 'openai', 'anthropic')
  messages: {                    // Chat history
    role: 'user' | 'assistant'
    content: string | MessageContent[]  // Text or multimodal content
    toolCallId?: string          // For tool response messages
    toolResult: boolean          // Whether this is a tool result
  }[]
  stream: any                    // Whether to stream response
}

// Tool call result interface
interface ToolCallResult {
  content?: string
  [key: string]: any
}

// 🚀 MCP Connection Pool for Ultra Performance
class McpConnectionPool {
  private static instance: McpConnectionPool
  private mcpService: McpService | null = null
  private tools: StructuredToolInterface[] = []
  private toolsMap: Record<string, StructuredToolInterface> = {}
  private isInitialized = false
  private initPromise: Promise<void> | null = null
  private lastHealthCheck = 0
  private healthCheckInterval = 30000 // 30 seconds

  private constructor() {}

  static getInstance(): McpConnectionPool {
    if (!McpConnectionPool.instance) {
      McpConnectionPool.instance = new McpConnectionPool()
    }
    return McpConnectionPool.instance
  }

  async initialize(): Promise<void> {
    if (this.isInitialized && this.isHealthy()) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[MCP Pool] Initializing MCP connection...')
      
      // Clean up existing connection if any
      if (this.mcpService) {
        await this.mcpService.close().catch(() => {})
      }
      
      this.mcpService = new McpService()
      this.tools = await this.mcpService.listTools()
      
      // Create tools map for O(1) lookup
      this.toolsMap = this.tools.reduce((acc, tool) => {
        acc[tool.name] = tool
        return acc
      }, {} as Record<string, StructuredToolInterface>)
      
      this.isInitialized = true
      this.lastHealthCheck = Date.now()
      
      console.log(`[MCP Pool] ✅ Initialized with ${this.tools.length} tools:`, this.tools.map(t => t.name))
    } catch (error) {
      console.error('[MCP Pool] ❌ Initialization failed:', error)
      this.isInitialized = false
      this.initPromise = null
      throw error
    }
  }

  getTools(): StructuredToolInterface[] {
    if (!this.isInitialized) {
      throw new Error('MCP Pool not initialized. Call initialize() first.')
    }
    return this.tools
  }

  getToolsMap(): Record<string, StructuredToolInterface> {
    if (!this.isInitialized) {
      throw new Error('MCP Pool not initialized. Call initialize() first.')
    }
    return this.toolsMap
  }

  async executeTool(toolName: string, args: any): Promise<any> {
    const tool = this.toolsMap[toolName]
    if (!tool) {
      throw new Error(`Tool ${toolName} not found in available tools: ${Object.keys(this.toolsMap).join(', ')}`)
    }
    
    console.log(`[MCP Pool] 🔧 Executing tool: ${toolName} with args:`, args)
    const result = await tool.invoke(args)
    console.log(`[MCP Pool] ✅ Tool ${toolName} completed`)
    return result
  }

  isHealthy(): boolean {
    const now = Date.now()
    if (now - this.lastHealthCheck > this.healthCheckInterval) {
      this.lastHealthCheck = now
      // Perform lightweight health check
      return this.isInitialized && this.mcpService !== null && this.tools.length > 0
    }
    return this.isInitialized && this.mcpService !== null
  }

  async cleanup(): Promise<void> {
    console.log('[MCP Pool] 🧹 Cleaning up...')
    if (this.mcpService) {
      await this.mcpService.close().catch(console.error)
      this.mcpService = null
    }
    this.isInitialized = false
    this.initPromise = null
    this.tools = []
    this.toolsMap = {}
  }

  // Get pool statistics
  getStats() {
    return {
      initialized: this.isInitialized,
      toolCount: this.tools.length,
      toolNames: this.tools.map(t => t.name),
      lastHealthCheck: new Date(this.lastHealthCheck).toISOString()
    }
  }
}

// System prompt template for RAG (Retrieval Augmented Generation)
const SYSTEM_TEMPLATE = `Answer the user's question based on the context below.
Present your answer in a structured Markdown format.

If the context doesn't contain any relevant information to the question, don't make something up and just say "I don't know":

<context>
{context}
</context>

<chat_history>
{chatHistory}
</chat_history>

<question>
{question}
</question>

Answer:
`

// Helper function: Convert messages array to string format for prompt
const serializeMessages = (messages: RequestBody['messages']): string =>
  messages.map((message) => {
    if (Array.isArray(message.content)) {
      // For multimodal messages (text + images), extract only text parts
      const textParts = message.content
        .filter((part): part is MessageContent & { text: string } =>
          part.type === 'text' && typeof part.text === 'string'
        )
        .map(part => part.text)
        .join(' ')
      return `${message.role}: ${textParts}`
    }
    // For simple text messages
    return `${message.role}: ${message.content}`
  }).join("\n")

// Helper function: Transform messages to LangChain format with better error handling
const transformMessages = (messages: RequestBody['messages']): BaseMessageLike[] => {
  return messages
    .filter(message => {
      // Filter out empty messages
      if (Array.isArray(message.content)) {
        const textContent = message.content
          .filter(part => part.type === 'text' && part.text && part.text.trim() !== '')
          .map(part => part.text)
          .join(' ')
        return textContent.trim() !== ''
      }
      return message.content && (message.content as string).trim() !== ''
    })
    .map((message) => {
      if (Array.isArray(message.content)) {
        // Handle multimodal content (text + images)
        const textContent = message.content
          .filter(part => part.type === 'text' && part.text)
          .map(part => part.text)
          .join(' ')
        
        return [message.role, textContent || 'No text content']
      }
      // Handle simple text content
      return [message.role, (message.content as string).trim()]
    })
}

// Helper function: Normalize messages to specific LangChain message types
const normalizeMessages = (messages: RequestBody['messages']): BaseMessage[] => {
  const normalizedMessages = []
  for (const message of messages) {
    if (message.toolResult) {
      // Tool execution results
      normalizedMessages.push(new ToolMessage(message.content as string, message.toolCallId!))
    } else if (message.role === "user") {
      // User messages (text or multimodal)
      if (Array.isArray(message.content)) {
        normalizedMessages.push(new HumanMessage({ content: message.content }))
      } else {
        normalizedMessages.push(new HumanMessage(message.content))
      }
    } else if (message.role === "assistant") {
      // Assistant messages
      normalizedMessages.push(new AIMessage(message.content as string))
    }
  }

  return normalizedMessages
}

// Helper function to safely convert results to string
const convertResultToString = (result: any): string => {
  if (typeof result === 'string') {
    return result
  }
  if (result && typeof result === 'object') {
    // Check for common result properties
    if (result.content) return result.content
    if (result.text) return result.text
    if (result.message) return result.message
    if (result.data) return JSON.stringify(result.data)
    return JSON.stringify(result, null, 2)
  }
  return String(result)
}

// Helper function to generate safe tool call IDs
const generateToolCallId = (toolName?: string): string => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substr(2, 9)
  return `${toolName || 'tool'}_${timestamp}_${random}`
}

// Extract user query from message content
const extractUserQuery = (content: string | MessageContent[]): string => {
  if (Array.isArray(content)) {
    return content
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text)
      .join(' ')
  }
  return content as string
}

// Check if model supports tool binding
const modelSupportsTools = (family: string): boolean => {
  const supportedFamilies = ['openai', 'anthropic', 'ollama']
  return supportedFamilies.includes(family.toLowerCase())
}

// Manual tool calling for models that don't support tool binding
const handleManualToolCalling = async (
  userMessage: string, 
  toolsMap: Record<string, StructuredToolInterface>,
  mcpPool: McpConnectionPool
): Promise<string | null> => {
  
  console.log("[Manual Tool] 🔍 Analyzing message:", userMessage)
  
  // Research/ArXiv keywords (more comprehensive)
  const researchKeywords = [
    'paper', 'papers', 'research', 'arxiv', 'study', 'studies', 'publication', 'publications',
    'เปเปอร์', 'งานวิจัย', 'บทความวิจัย', 'หาเปเปอร์', 'แนะนำเปเปอร์', 'แนะนำ', 'ช่วย'
  ]
  
  const isResearchQuery = researchKeywords.some(keyword => 
    userMessage.toLowerCase().includes(keyword.toLowerCase())
  )
  
  console.log("[Manual Tool] 🎯 Is research query:", isResearchQuery)
  console.log("[Manual Tool] 🛠️ Available tools:", Object.keys(toolsMap))
  
  if (isResearchQuery && toolsMap['arxiv_query']) {
    try {
      console.log('[Manual Tool] 🔍 Detected research query, using ArXiv tool')
      
      // Extract search terms from user message
      let searchQuery = userMessage
        .replace(/ช่วย|แนะนำ|หา|ค้นหา|เกี่ยวกับ|เกี่ยวข้องกับ|please|find|search|recommend|หน่อย/gi, '')
        .replace(/เปเปอร์|งานวิจัย|paper|papers|research|publication/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
      
      // If search query is empty or too short, use the original message
      if (searchQuery.length < 3) {
        searchQuery = userMessage
      }
      
      console.log('[Manual Tool] 🔍 Final search query:', searchQuery)
      
      const arxivResult = await mcpPool.executeTool('arxiv_query', { 
        query: searchQuery,
        max_results: 5
      })
      
      const resultContent = convertResultToString(arxivResult)
      
      return `ผมค้นหาเปเปอร์ที่เกี่ยวข้องกับ "${searchQuery}" ให้แล้วครับ:\n\n${resultContent}`
    } catch (error) {
      console.error('[Manual Tool] ❌ ArXiv tool failed:', error)
      return `เกิดข้อผิดพลาดในการค้นหาเปเปอร์: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
  
  console.log("[Manual Tool] ❌ No matching tools found")
  
  // Add more manual tool handlers here for other tools
  
  return null // No manual tool calling needed
}

// Main API handler
export default defineEventHandler(async (event) => {
  // Parse request body
  const { knowledgebaseId, model, family, messages, stream } = await readBody<RequestBody>(event)

  console.log(`[Chat] 🚀 Starting chat with model: ${family}/${model}, streaming: ${!!stream}`)

  // KNOWLEDGE BASE CHAT PATH
  if (knowledgebaseId) {
    console.log("[RAG] 📚 Chat with knowledge base ID:", knowledgebaseId)
    
    // Fetch knowledge base from database
    const knowledgebase = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgebaseId }
    })
    
    console.log(`[RAG] Knowledge base: ${knowledgebase?.name} with embedding: ${knowledgebase?.embedding}`)
    
    if (!knowledgebase) {
      setResponseStatus(event, 404, `Knowledge base with id ${knowledgebaseId} not found`)
      return
    }

    // Create embeddings model for vector search
    const embeddings = createEmbeddings(knowledgebase.embedding!, event)
    
    // Create retriever for finding relevant documents
    const retriever = await createRetriever(embeddings, `collection_${knowledgebase.id}`)

    // Create chat model
    const chat = createChatModel(model, family, event)
    
    // Extract user query from the last message
    const query = extractUserQuery(messages[messages.length - 1].content)
    console.log("[RAG] User query:", query)

    // TODO: Coreference resolution (currently commented out)
    const reformulatedQuery = query
    console.log("[RAG] Reformulated query:", reformulatedQuery)

    // Retrieve relevant documents from vector store
    const relevant_docs = await retriever.invoke(reformulatedQuery)
    console.log("[RAG] Found relevant documents:", relevant_docs.length)

    let rerankedDocuments = relevant_docs

    // OPTIONAL: Cohere reranking for better document relevance
    if ((process.env.COHERE_API_KEY || process.env.COHERE_BASE_URL) && process.env.COHERE_MODEL) {
      const options = {
        apiKey: process.env.COHERE_API_KEY,
        baseUrl: process.env.COHERE_BASE_URL,
        model: process.env.COHERE_MODEL,
        topN: 4
      }
      console.log("[RAG] Using Cohere rerank with options:", options)
      const cohereRerank = new CohereRerank(options)
      rerankedDocuments = await cohereRerank.compressDocuments(relevant_docs, reformulatedQuery)
      console.log("[RAG] Reranked to:", rerankedDocuments.length, "documents")
    }

    // Create RAG chain: Context + Chat History + Question → LLM
    const chain = RunnableSequence.from([
      {
        question: (input: { question: string; chatHistory?: string }) => input.question,
        chatHistory: (input: { question: string; chatHistory?: string }) => input.chatHistory ?? "",
        context: async () => formatDocumentsAsString(rerankedDocuments)
      },
      PromptTemplate.fromTemplate(SYSTEM_TEMPLATE),
      chat
    ])

    // NON-STREAMING RESPONSE
    if (!stream) {
      const response = await chain.invoke({
        question: query,
        chatHistory: serializeMessages(messages),
      })

      return {
        message: {
          role: 'assistant',
          content: typeof response?.content === 'string' ? response.content : response?.content.toString(),
          relevant_docs: rerankedDocuments
        }
      }
    }

    // STREAMING RESPONSE
    setEventStreamResponse(event)
    const response = await chain.stream({
      question: query,
      chatHistory: serializeMessages(messages),
    })

    const readableStream = Readable.from((async function* () {
      for await (const chunk of response) {
        if (chunk?.content !== undefined) {
          const message = {
            message: {
              role: 'assistant',
              content: chunk?.content
            }
          }
          yield `${JSON.stringify(message)} \n\n`
        }
      }

      // Send relevant documents at the end
      const docsChunk = {
        type: "relevant_documents",
        relevant_documents: rerankedDocuments
      }
      yield `${JSON.stringify(docsChunk)} \n\n`
    })())
    
    return sendStream(event, readableStream)
    
  } else {
    // 🚀 REGULAR CHAT PATH - ULTRA OPTIMIZED WITH CONNECTION POOL
    
    // Create chat model
    let llm = createChatModel(model, family, event)

    // 🚀 ULTRA OPTIMIZATION: Use persistent connection pool
    const mcpPool = McpConnectionPool.getInstance()
    let normalizedTools: StructuredToolInterface[] = []
    let toolsMap: Record<string, StructuredToolInterface> = {}
    
    try {
      // Initialize pool if needed (only happens once per server lifetime)
      if (!mcpPool.isHealthy()) {
        console.log('[Chat] 🔄 Initializing MCP pool...')
        await mcpPool.initialize()
      }
      
      // Get tools from pool (ultra fast - no network calls!)
      normalizedTools = mcpPool.getTools()
      toolsMap = mcpPool.getToolsMap()
      
      console.log(`[Chat] 🛠️ Found ${normalizedTools.length} tools:`, normalizedTools.map(t => t.name))
      console.log('[Chat] 📊 Pool stats:', mcpPool.getStats())
      
      // Check if model supports tool binding
      const supportsTools = modelSupportsTools(family)
      console.log(`[Chat] Model ${family}/${model} supports tools:`, supportsTools)
      
      if (normalizedTools.length > 0 && supportsTools && llm?.bindTools) {
        console.log("[Chat] 🔗 Binding tools to LLM")
        llm = llm.bindTools(normalizedTools) as BaseChatModel
      } else if (normalizedTools.length > 0 && !supportsTools) {
        console.log(`[Chat] ⚡ Model doesn't support tool binding - will use manual tool calling`)
      }
    } catch (error) {
      console.warn("[Chat] ⚠️ MCP pool initialization failed:", error)
      // Continue without tools - don't break the chat
    }

    // NON-STREAMING RESPONSE - ULTRA OPTIMIZED
    if (!stream) {
      try {
        // Extract user query for manual tool detection
        const lastMessage = messages[messages.length - 1]
        const userQuery = extractUserQuery(lastMessage.content)

        // Try manual tool calling first (for models that don't support tool binding)
        if (!modelSupportsTools(family) && Object.keys(toolsMap).length > 0) {
          const manualToolResult = await handleManualToolCalling(userQuery, toolsMap, mcpPool)
          if (manualToolResult) {
            return {
              message: {
                role: 'assistant',
                content: manualToolResult
              }
            }
          }
        }

        const response = await llm.invoke(transformMessages(messages))
        
        // Handle automatic tool calls (for models that support tool binding)
        if (response.tool_calls && Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
          console.log("[Chat] 🔧 Processing", response.tool_calls.length, "tool calls:", response.tool_calls.map(tc => tc.name))
          
          // 🚀 ULTRA OPTIMIZATION: Execute all tools in parallel
          const toolPromises = response.tool_calls.map(async (toolCall, index) => {
            try {
              console.log(`[Chat] 🔧 Executing tool ${index + 1}/${response.tool_calls.length}: ${toolCall.name}`)
              
              const toolCallId = toolCall.id || generateToolCallId(toolCall.name)
              
              // Use pool's execute method (reuses connection, no overhead)
              const result = await mcpPool.executeTool(toolCall.name, toolCall.args)
              const resultContent = convertResultToString(result)
              
              console.log(`[Chat] ✅ Tool ${toolCall.name} completed successfully`)
              
              return {
                tool_call_id: toolCallId,
                content: resultContent
              }
            } catch (toolError) {
              console.error(`[Chat] ❌ Tool ${toolCall.name} failed:`, toolError)
              
              const toolCallId = toolCall.id || generateToolCallId(toolCall.name)
              return {
                tool_call_id: toolCallId,
                content: `Tool execution failed: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`
              }
            }
          })
          
          // Wait for all tools to complete in parallel
          const toolResults = await Promise.all(toolPromises)
          console.log(`[Chat] 🎉 All ${toolResults.length} tools completed`)
          
          // Get final response with tool results
          if (toolResults.length > 0) {
            const toolMessages = toolResults.map(tr => 
              new ToolMessage(tr.content, tr.tool_call_id)
            )
            
            const finalMessages = [
              ...normalizeMessages(messages),
              response,
              ...toolMessages
            ]
            
            const finalResponse = await llm.invoke(finalMessages)
            
            return {
              message: {
                role: 'assistant',
                content: typeof finalResponse?.content === 'string' ? finalResponse.content : finalResponse?.content.toString(),
                tool_calls: response.tool_calls,
                tool_results: toolResults
              }
            }
          }
        }

        return {
          message: {
            role: 'assistant',
            content: typeof response?.content === 'string' ? response.content : response?.content.toString()
          }
        }
      } catch (error) {
        console.error('[Chat] ❌ Error in non-streaming response:', error)
        throw error
      }
    }

    // STREAMING RESPONSE - ULTRA OPTIMIZED
    console.log("[Chat] 🌊 Starting streaming response")
    
    // Extract user query for manual tool detection BEFORE streaming starts
    const lastMessage = messages[messages.length - 1]
    const userQuery = extractUserQuery(lastMessage.content)
    console.log("[Chat] 🔍 User query for tool detection:", userQuery)
    
    const readableStream = Readable.from((async function* () {
      try {
        // Try manual tool calling first (for models that don't support tool binding)
        if (!modelSupportsTools(family) && Object.keys(toolsMap).length > 0) {
          console.log("[Chat] 🔧 Attempting manual tool calling for NVIDIA model...")
          const manualToolResult = await handleManualToolCalling(userQuery, toolsMap, mcpPool)
          if (manualToolResult) {
            console.log("[Chat] ✅ Manual tool calling successful")
            const message = {
              message: {
                role: 'assistant',
                content: manualToolResult
              }
            }
            yield `${JSON.stringify(message)} \n\n`
            return
          } else {
            console.log("[Chat] ❌ Manual tool calling returned null")
          }
        }

        // Continue with normal streaming for models that support tool binding
        const transformedMessages = transformMessages(messages)
        const response = await llm?.stream(transformedMessages)
        let gathered = undefined

        // Stream response chunks
        for await (const chunk of response) {
          gathered = gathered !== undefined ? concat(gathered, chunk) : chunk

          let content = chunk?.content
          if (Array.isArray(content)) {
            content = content
              .filter((item): item is { type: string; text: string } => 
                (item.type === 'text_delta' || item.type === 'text') && 'text' in item
              )
              .map(item => item.text)
              .join('')
          }

          const message = {
            message: {
              role: 'assistant',
              content: content
            }
          }
          yield `${JSON.stringify(message)} \n\n`
        }

        // 🚀 ULTRA OPTIMIZED: Tool execution with full parallel processing
        const toolMessages = [] as ToolMessage[]
        console.log("[Chat] 📦 Gathered response with tool calls:", gathered?.tool_calls?.length || 0)
        
        if (gathered?.tool_calls && Array.isArray(gathered.tool_calls) && gathered.tool_calls.length > 0) {
          console.log("[Chat] 🔧 Processing tool calls in parallel...")
          
          // Execute all tools in parallel for maximum speed
          const toolPromises = gathered.tool_calls.map(async (toolCall: any, index: number) => {
            console.log(`[Chat] 🔧 Starting tool ${index + 1}/${gathered.tool_calls?.length || 0}: ${toolCall.name}`)
            
            try {
              const toolCallId = toolCall.id || generateToolCallId(toolCall.name)
              
              // Use pool's execute method (no connection overhead)
              const result = await mcpPool.executeTool(toolCall.name, toolCall.args || toolCall)
              const resultContent = convertResultToString(result)

              console.log(`[Chat] ✅ Tool ${toolCall.name} completed successfully`)

              return {
                success: true,
                toolCallId,
                content: resultContent,
                message: {
                  message: {
                    role: "user",
                    type: "tool_result",
                    tool_use_id: toolCallId,
                    content: resultContent
                  }
                }
              }
            } catch (toolError) {
              console.error(`[Chat] ❌ Tool ${toolCall.name} execution failed:`, toolError)
              
              const toolCallId = toolCall.id || generateToolCallId(toolCall.name)
              return {
                success: false,
                toolCallId,
                content: `Tool execution failed: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`,
                message: {
                  message: {
                    role: "user", 
                    type: "tool_error",
                    tool_use_id: toolCallId,
                    content: `Tool execution failed: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`
                  }
                }
              }
            }
          })

          // Wait for all tools and stream results as they complete
          const toolResults = await Promise.all(toolPromises)
          console.log(`[Chat] 🎉 All ${toolResults.length} tools completed`)
          
          for (const result of toolResults) {
            if (result.success) {
              toolMessages.push(new ToolMessage(result.content, result.toolCallId))
            }
            yield `${JSON.stringify(result.message)} \n\n`
          }
        }

        // FINAL RESPONSE WITH TOOL RESULTS
        if (toolMessages.length) {
          console.log("[Chat] 🔄 Generating final response with tool results")
          const finalMessages = [
            ...transformMessages(messages),
            new AIMessage(gathered as AIMessageFields),
            ...toolMessages
          ]
          
          const finalResponse = await llm.stream(finalMessages as BaseMessageLike[])

          for await (const chunk of finalResponse) {
            let content = chunk?.content
            if (Array.isArray(content)) {
              content = content
                .filter((item): item is MessageContent & { type: 'text_delta'; text: string } | { type: 'text'; text: string } =>
                  item.type === 'text_delta' && 'text' in item || item.type === 'text' && 'text' in item
                )
                .map(item => item.text)
                .join('')
            }

            const message = {
              message: {
                role: 'assistant',
                content: content
              }
            }
            yield `${JSON.stringify(message)} \n\n`
          }
        }
        
        console.log("[Chat] 🏁 Streaming completed successfully")
        
      } catch (streamError) {
        console.error('[Chat] ❌ Streaming error:', streamError)
        
        const errorMessage = {
          message: {
            role: 'assistant',
            content: 'เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง\n\nError details: ' + (streamError instanceof Error ? streamError.message : 'Unknown error')
          }
        }
        yield `${JSON.stringify(errorMessage)} \n\n`
      }
      // Note: No cleanup needed - pool persists across requests for maximum performance
    })())

    return sendStream(event, readableStream)
  }
})