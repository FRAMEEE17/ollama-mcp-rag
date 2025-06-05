import { Readable } from 'stream'
import { formatDocumentsAsString } from "langchain/util/document"
import { PromptTemplate } from "@langchain/core/prompts"
import { RunnableSequence } from "@langchain/core/runnables"
import { CohereRerank } from "@/server/rerank/cohere"
import { setEventStreamResponse } from '@/server/utils'
import { BaseRetriever } from "@langchain/core/retrievers"
import prisma from "@/server/utils/prisma"
import { createChatModel, createEmbeddings } from '@/server/utils/models'
import { createRetriever } from '@/server/retriever'
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { resolveCoreference } from '~/server/coref'
import { concat } from "@langchain/core/utils/stream"
import { MODEL_FAMILIES } from '~/config'

// FIXED: Use the corrected MCP service
import { MCPService } from '@/server/utils/mcp'

interface MessageContent {
  type: string
  text?: string
  image_url?: { url: string }
}

interface RequestBody {
  knowledgebaseId?: number
  model: string
  family: string
  messages: {
    role: 'user' | 'assistant' | 'system'
    content: string | MessageContent[]
    toolCallId?: string
    toolResult?: boolean
  }[]
  stream?: boolean
}

/**
 * CRITICAL FIX: Proper Nuxt 3 API handler export
 * This resolves the "Invalid lazy handler result" error
 */
export default defineEventHandler(async (event) => {
  try {
    console.log('[Chat Handler] Processing request...')
    
    // Read and validate request body with proper error handling
    let requestBody: RequestBody
    try {
      requestBody = await readBody(event)
    } catch (readError) {
      console.error('[Chat Handler] Failed to read body:', readError)
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request body - expected JSON'
      })
    }
    
    if (!requestBody || typeof requestBody !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request body format'
      })
    }

    const { model, family, messages, stream = false, knowledgebaseId } = requestBody
    
    // Validate required fields
    if (!model || !family || !messages || !Array.isArray(messages)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: model, family, messages'
      })
    }

    console.log(`[Chat Handler] Processing ${messages.length} messages with ${family}/${model}`)
    
    // Extract the latest user message for analysis
    const lastMessage = messages[messages.length - 1]
    const userContent = extractMessageContent(lastMessage)
    
    // Initialize the chat model with proper error handling
    let chatModel
    try {
      chatModel = createChatModel(model, family, event)
    } catch (modelError) {
      console.error('[Chat Handler] Model creation failed:', modelError)
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to create ${family} model: ${modelError instanceof Error ? modelError.message : 'Unknown error'}`
      })
    }
    
    // Intelligent routing: check if this is a research query
    if (shouldUseResearchTools(userContent)) {
      console.log('[Chat Handler] Research query detected - using MCP tools')
      return await handleResearchQuery(userContent, chatModel, stream, event)
    }
    
    // Handle regular chat without tools
    console.log('[Chat Handler] Regular chat query detected')
    return await handleRegularChat(messages, chatModel, stream, event, knowledgebaseId)
    
  } catch (error) {
    console.error('[Chat Handler] Error:', error)
    
    // Return structured error response
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error // Re-throw HTTP errors as-is
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Internal server error'
    })
  }
})

/**
 * FIXED: Enhanced message content extraction with proper type handling
 */
function extractMessageContent(message: any): string {
  if (!message) return ''
  
  if (typeof message.content === 'string') {
    return message.content
  }
  
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part: any) => part && part.type === 'text')
      .map((part: any) => part.text || '')
      .join(' ')
      .trim()
  }
  
  return ''
}

/**
 * ENHANCED: More sophisticated research query detection
 */
function shouldUseResearchTools(message: string): boolean {
  if (!message || typeof message !== 'string') return false
  
  const researchKeywords = [
    // Academic terms
    'paper', 'papers', 'research', 'arxiv', 'study', 'studies', 'publication',
    'academic', 'journal', 'article', 'thesis', 'dissertation',
    
    // Search terms
    'find', 'search', 'recommend', 'suggest', 'help', 'show', 'about', 'on',
    'latest', 'recent', 'new', 'current', 'trending',
    
    // Technical domains
    'machine learning', 'deep learning', 'artificial intelligence', 'neural network',
    'computer science', 'algorithm', 'model', 'method', 'technique',
    'transformer', 'llm', 'gpt', 'bert', 'nlp', 'cv', 'computer vision',
    
    // Thai research terms
    'เปเปอร์', 'งานวิจัย', 'บทความวิจัย', 'หาเปเปอร์', 'แนะนำเปเปอร์', 'แนะนำ', 
    'ช่วย', 'หา', 'ค้นหา', 'เกี่ยวกับ', 'วิจัย', 'การศึกษา'
  ]
  
  const messageLower = message.toLowerCase()
  const hasResearchKeyword = researchKeywords.some(keyword => 
    messageLower.includes(keyword.toLowerCase())
  )
  
  // Additional context clues
  const hasQuestionWords = /\b(what|how|why|when|where|which|who)\b/i.test(message)
  const hasAcademicContext = /\b(paper|research|study|article)\b/i.test(message)
  
  return hasResearchKeyword || (hasQuestionWords && hasAcademicContext)
}

/**
 * FIXED: Research query handler with improved error handling
 */
async function handleResearchQuery(
  query: string, 
  chatModel: any, 
  stream: boolean,
  event: any
): Promise<any> {
  
  try {
    console.log('[Research Handler] Starting research for:', query)
    
    // Initialize MCP service with timeout
    const mcpService = new MCPService()
    
    // Extract search terms with better logic
    const searchTerms = extractSearchTerms(query)
    console.log('[Research Handler] Extracted search terms:', searchTerms)
    
    // Search ArXiv using MCP with timeout
    const searchPromise = mcpService.searchArxiv(searchTerms, 5)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('ArXiv search timeout')), 30000)
    )
    
    const searchResult = await Promise.race([searchPromise, timeoutPromise]) as any
    
    if (!searchResult.success) {
      console.error('[Research Handler] ArXiv search failed:', searchResult.error)
      return createErrorResponse('Research search failed: ' + (searchResult.error || 'Unknown error'))
    }
    
    console.log(`[Research Handler] Found ${searchResult.papers?.length || 0} papers`)
    
    // Generate response using the chat model with proper message formatting
    const researchPrompt = buildResearchPrompt(query, searchResult)
    const formattedMessages = formatMessagesForModel([{ role: 'user', content: researchPrompt }])
    
    if (stream) {
      return handleStreamingResponse(formattedMessages, chatModel, event)
    } else {
      const response = await chatModel.invoke(formattedMessages)
      return createSuccessResponse(response.content)
    }
    
  } catch (error) {
    console.error('[Research Handler] Error:', error)
    return createErrorResponse('Research processing failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }
}

/**
 * FIXED: Regular chat handler with knowledge base integration
 */
async function handleRegularChat(
  messages: any[], 
  chatModel: any, 
  stream: boolean, 
  event: any,
  knowledgebaseId?: number
): Promise<any> {
  
  try {
    console.log('[Regular Chat] Processing regular chat query')
    
    let context = ''
    
    // Retrieve knowledge base context if specified
    if (knowledgebaseId) {
      try {
        context = await retrieveKnowledgeBaseContext(messages, knowledgebaseId, event)
      } catch (kbError) {
        console.warn('[Regular Chat] Knowledge base retrieval failed:', kbError)
        // Continue without context rather than failing the entire request
      }
    }
    
    // Format messages for the chat model with enhanced error handling
    const formattedMessages = formatMessagesForModel(messages, context)
    
    if (stream) {
      return handleStreamingResponse(formattedMessages, chatModel, event)
    } else {
      const response = await chatModel.invoke(formattedMessages)
      return createSuccessResponse(response.content)
    }
    
  } catch (error) {
    console.error('[Regular Chat] Error:', error)
    return createErrorResponse('Chat processing failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }
}

/**
 * ENHANCED: Better search term extraction with domain knowledge
 */
function extractSearchTerms(query: string): string {
  // Remove common research-related stop words but preserve technical terms
  const stopWords = ['help', 'find', 'search', 'recommend', 'show', 'me', 'about', 'on', 'papers', 'research', 
                     'ช่วย', 'หา', 'แนะนำ', 'เปเปอร์', 'งานวิจัย', 'หน่อย', 'ครับ', 'ค่ะ']
  
  // Clean the query
  let cleanQuery = query
    .toLowerCase()
    .replace(/ช่วย|แนะนำ|หา|ค้นหา|เกี่ยวกับ|หน่อย|ครับ|ค่ะ/gi, '')
    .replace(/please|find|search|recommend|help|show|me|some|about|on|papers?|research/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  // If cleaned query is too short, extract technical terms
  if (cleanQuery.length < 3) {
    const technicalTerms = query.match(
      /machine learning|deep learning|artificial intelligence|neural network|computer science|transformer|llm|gpt|bert|nlp|computer vision|การเรียนรู้ของเครื่อง|ปัญญาประดิษฐ์/gi
    )
    
    if (technicalTerms && technicalTerms.length > 0) {
      cleanQuery = technicalTerms[0]
    } else {
      // Extract meaningful words (length > 2, not stop words)
      const words = query.split(' ').filter(word => 
        word.length > 2 && !stopWords.includes(word.toLowerCase())
      )
      cleanQuery = words.slice(0, 3).join(' ')
    }
  }
  
  return cleanQuery || query.split(' ').slice(0, 2).join(' ')
}

/**
 * FIXED: Research prompt builder with better formatting
 */
function buildResearchPrompt(originalQuery: string, searchResult: any): string {
  const papers = searchResult.papers || []
  
  if (papers.length === 0) {
    return `I searched for research papers related to "${originalQuery}" but didn't find any relevant results. Please provide information based on your general knowledge about this topic.`
  }
  
  let prompt = `Based on the research query "${originalQuery}", I found ${papers.length} relevant papers. Please provide a comprehensive analysis:\n\n`
  
  papers.forEach((paper: any, index: number) => {
    prompt += `${index + 1}. **${paper.title}**\n`
    prompt += `   Authors: ${paper.authors?.map((a: any) => a.name).join(', ') || 'Unknown'}\n`
    prompt += `   Published: ${new Date(paper.published).toLocaleDateString()}\n`
    prompt += `   Categories: ${paper.categories?.join(', ') || 'N/A'}\n`
    prompt += `   Summary: ${paper.summary?.substring(0, 200)}...\n`
    prompt += `   PDF: ${paper.pdf_url}\n\n`
  })
  
  prompt += `Please provide:\n`
  prompt += `1. A comprehensive summary of the key findings and trends\n`
  prompt += `2. Analysis of how these papers relate to the original query\n`
  prompt += `3. Practical insights and applications\n`
  prompt += `4. Recommendations for further reading\n\n`
  prompt += `Structure your response to be informative and actionable for researchers and practitioners.`
  
  return prompt
}

/**
 * ENHANCED: Knowledge base context retrieval with error handling
 */
async function retrieveKnowledgeBaseContext(
  messages: any[], 
  knowledgebaseId: number, 
  event: any
): Promise<string> {
  
  try {
    console.log('[Knowledge Base] Retrieving context for KB:', knowledgebaseId)
    
    // Get knowledge base info with validation
    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgebaseId }
    })
    
    if (!knowledgeBase) {
      console.warn('[Knowledge Base] Knowledge base not found:', knowledgebaseId)
      return ''
    }
    
    // Extract query from the last user message
    const lastMessage = messages[messages.length - 1]
    const query = extractMessageContent(lastMessage)
    
    if (!query.trim()) {
      console.warn('[Knowledge Base] Empty query, skipping retrieval')
      return ''
    }
    
    // Create embeddings and retriever with proper error handling
    const embeddings = createEmbeddings(knowledgeBase.embedding!, event)
    const retriever = await createRetriever(
      embeddings,
      `collection_${knowledgebaseId}`,
      null, // No new documents to add
      knowledgeBase.parentChunkSize || 3000,
      knowledgeBase.parentChunkOverlap || 200,
      knowledgeBase.childChunkSize || 1000,
      knowledgeBase.childChunkOverlap || 50,
      knowledgeBase.parentK || 10,
      knowledgeBase.childK || 20
    )
    
    // Retrieve relevant documents with timeout
    const retrievalPromise = retriever.getRelevantDocuments(query)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Retrieval timeout')), 15000)
    )
    
    const relevantDocs = await Promise.race([retrievalPromise, timeoutPromise]) as any[]
    
    if (!relevantDocs || relevantDocs.length === 0) {
      console.log('[Knowledge Base] No relevant documents found')
      return ''
    }
    
    console.log(`[Knowledge Base] Retrieved ${relevantDocs.length} relevant documents`)
    
    // Format documents as context (limit to top 5 for token efficiency)
    return formatDocumentsAsString(relevantDocs.slice(0, 5))
    
  } catch (error) {
    console.error('[Knowledge Base] Error retrieving context:', error)
    // Return empty context rather than failing the whole request
    return ''
  }
}

/**
 * FIXED: Message formatting for various model types (NVIDIA/VLLM compatible)
 */
function formatMessagesForModel(messages: any[], context: string = ''): BaseMessage[] {
  const formattedMessages: BaseMessage[] = []
  
  // Add system message with context if available
  if (context && context.trim()) {
    const systemPrompt = `You are a helpful research assistant. Use the context below to answer questions when relevant.

Context:
${context}

If the context doesn't contain relevant information, use your general knowledge but mention that the answer is not from the provided context.`

    formattedMessages.push(new HumanMessage(systemPrompt))
  }
  
  // Convert messages to LangChain format with proper validation
  messages.forEach(msg => {
    if (!msg || typeof msg !== 'object') return
    
    const content = extractMessageContent(msg)
    if (!content.trim()) return // Skip empty messages
    
    // Normalize role names for compatibility
    let role = msg.role
    if (role === 'user' || role === 'human') {
      formattedMessages.push(new HumanMessage(content))
    } else if (role === 'assistant' || role === 'ai') {
      formattedMessages.push(new AIMessage(content))
    } else {
      // Default unknown roles to user
      formattedMessages.push(new HumanMessage(content))
    }
  })
  
  // Ensure we have at least one message
  if (formattedMessages.length === 0) {
    formattedMessages.push(new HumanMessage('Please provide a response.'))
  }
  
  return formattedMessages
}

/**
 * ENHANCED: Streaming response handler with better error handling
 */
async function handleStreamingResponse(
  messages: BaseMessage[], 
  chatModel: any, 
  event: any
): Promise<any> {
  
  try {
    console.log('[Streaming] Setting up streaming response')
    setEventStreamResponse(event)
    
    // Create the stream with timeout
    const streamPromise = chatModel.stream(messages)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Streaming timeout')), 60000)
    )
    
    const stream = await Promise.race([streamPromise, timeoutPromise]) as any
    
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = ''
          
          for await (const chunk of stream) {
            const content = chunk.content || ''
            fullContent += content
            
            // Send chunk to client
            const chunkData = JSON.stringify({
              content,
              done: false,
              timestamp: new Date().toISOString()
            })
            
            controller.enqueue(`data: ${chunkData}\n\n`)
          }
          
          // Send completion signal
          const completionData = JSON.stringify({
            content: '',
            done: true,
            fullContent,
            timestamp: new Date().toISOString()
          })
          
          controller.enqueue(`data: ${completionData}\n\n`)
          controller.close()
          
        } catch (streamError) {
          console.error('[Streaming] Stream error:', streamError)
          
          // Send error to client
          const errorData = JSON.stringify({
            error: streamError instanceof Error ? streamError.message : 'Streaming failed',
            done: true,
            timestamp: new Date().toISOString()
          })
          
          controller.enqueue(`data: ${errorData}\n\n`)
          controller.close()
        }
      }
    })
    
    return sendStream(event, readableStream)
    
  } catch (error) {
    console.error('[Streaming] Error setting up stream:', error)
    
    // Fall back to non-streaming response
    try {
      const response = await chatModel.invoke(messages)
      return createSuccessResponse(response.content)
    } catch (fallbackError) {
      console.error('[Streaming] Fallback also failed:', fallbackError)
      return createErrorResponse('Both streaming and fallback failed')
    }
  }
}

/**
 * Helper functions for response creation
 */
function createSuccessResponse(content: string): any {
  return {
    success: true,
    content,
    timestamp: new Date().toISOString(),
    type: 'completion'
  }
}

function createErrorResponse(error: string): any {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
    type: 'error'
  }
}