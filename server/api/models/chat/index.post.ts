// server/api/models/chat/index.post.ts
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

// UPDATED: Use simplified direct MCP approach
import { MCPService } from '@/server/utils/mcp'

interface MessageContent {
  type: string
  text?: string
  image_url?: { url: string }
}

interface RequestBody {
  knowledgebaseId: number
  model: string
  family: string
  messages: {
    role: 'user' | 'assistant'
    content: string | MessageContent[]
    toolCallId?: string
    toolResult: boolean
  }[]
  stream: any
}

// This is the critical fix - proper Nuxt 3 API handler export
export default defineEventHandler(async (event) => {
  try {
    console.log('[Chat Handler] Processing request...')
    
    // Read and validate request body
    const requestBody = await readBody(event) as RequestBody
    
    if (!requestBody || typeof requestBody !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request body'
      })
    }

    const { model, family, messages, stream, knowledgebaseId } = requestBody
    
    // Validate required fields
    if (!model || !family || !messages) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required fields: model, family, messages'
      })
    }

    console.log(`[Chat Handler] Processing ${messages.length} messages with ${family}/${model}`)
    
    // Extract the latest user message for analysis
    const lastMessage = messages[messages.length - 1]
    const userContent = extractMessageContent(lastMessage)
    
    // Initialize the chat model
    const chatModel = createChatModel(model, family, event)
    
    // Check if this is a research query that needs tool assistance
    if (shouldUseResearchTools(userContent)) {
      console.log('[Chat Handler] Research query detected - using MCP tools')
      return await handleResearchQuery(userContent, chatModel, stream, event)
    }
    
    // Handle regular chat without tools
    console.log('[Chat Handler] Regular chat query detected')
    return await handleRegularChat(messages, chatModel, stream, event, knowledgebaseId)
    
  } catch (error) {
    console.error('[Chat Handler] Error:', error)
    
    // Ensure we return a proper error response
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Internal server error'
    })
  }
})

// Helper function to extract text content from various message formats
function extractMessageContent(message: any): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  
  if (Array.isArray(message.content)) {
    interface MessageContentPart {
      type: string;
      text?: string;
    }

    return message.content
      .filter((part: MessageContentPart) => part.type === 'text')
      .map((part: MessageContentPart) => part.text)
      .join(' ')
  }
  
  return ''
}

// Intelligent detection of research queries
function shouldUseResearchTools(message: string): boolean {
  const researchKeywords = [
    'paper', 'papers', 'research', 'arxiv', 'study', 'studies', 'publication',
    'find', 'search', 'recommend', 'suggest', 'help', 'show', 'about', 'on',
    'machine learning', 'deep learning', 'artificial intelligence', 'neural network',
    'computer science', 'algorithm', 'model', 'method', 'technique',
    'เปเปอร์', 'งานวิจัย', 'บทความวิจัย', 'หาเปเปอร์', 'แนะนำเปเปอร์', 'แนะนำ', 
    'ช่วย', 'หา', 'ค้นหา', 'เกี่ยวกับ', 'วิจัย', 'การศึกษา'
  ]
  
  const messageLower = message.toLowerCase()
  return researchKeywords.some(keyword => 
    messageLower.includes(keyword.toLowerCase())
  )
}

// Handle research queries using MCP tools
async function handleResearchQuery(
  query: string, 
  chatModel: any, 
  stream: boolean,
  event: any
): Promise<any> {
  
  try {
    console.log('[Research Handler] Starting research for:', query)
    
    // Initialize MCP service for ArXiv search
    const mcpService = new MCPService()
    
    // Extract search terms from the query
    const searchTerms = extractSearchTerms(query)
    console.log('[Research Handler] Extracted search terms:', searchTerms)
    
    // Search ArXiv using MCP
    const searchResult = await mcpService.searchArxiv(searchTerms, 5)
    
    if (!searchResult.success) {
      console.error('[Research Handler] ArXiv search failed:', searchResult.error)
      return createErrorResponse('Research search failed: ' + searchResult.error)
    }
    
    console.log(`[Research Handler] Found ${searchResult.papers?.length || 0} papers`)
    
    // Generate response using the chat model
    const researchPrompt = buildResearchPrompt(query, searchResult)
    const messages = [new HumanMessage(researchPrompt)]
    
    if (stream) {
      return handleStreamingResponse(messages, chatModel, event)
    } else {
      const response = await chatModel.invoke(messages)
      return createSuccessResponse(response.content)
    }
    
  } catch (error) {
    console.error('[Research Handler] Error:', error)
    return createErrorResponse('Research processing failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }
}

// Handle regular chat queries (with optional knowledge base integration)
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
    
    // If knowledge base is specified, retrieve relevant context
    if (knowledgebaseId) {
      context = await retrieveKnowledgeBaseContext(messages, knowledgebaseId, event)
    }
    
    // Format messages for the chat model
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

// Extract meaningful search terms from user query
function extractSearchTerms(query: string): string {
  // Remove common research-related words that don't add value to search
  const stopWords = ['help', 'find', 'search', 'recommend', 'show', 'me', 'about', 'on', 'papers', 'research', 'ช่วย', 'หา', 'แนะนำ', 'เปเปอร์', 'งานวิจัย']
  
  let cleanQuery = query
    .toLowerCase()
    .replace(/ช่วย|แนะนำ|หา|ค้นหา|เกี่ยวกับ|หน่อย|ครับ|ค่ะ/gi, '')
    .replace(/please|find|search|recommend|help|show|me|some|about|on|papers?|research/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  // If the cleaned query is too short, try to extract technical terms
  if (cleanQuery.length < 3) {
    const technicalTerms = query.match(/machine learning|deep learning|artificial intelligence|neural network|computer science|การเรียนรู้ของเครื่อง|ปัญญาประดิษฐ์/gi)
    if (technicalTerms && technicalTerms.length > 0) {
      cleanQuery = technicalTerms[0]
    } else {
      // Fall back to first few meaningful words
      const words = query.split(' ').filter(word => 
        word.length > 2 && !stopWords.includes(word.toLowerCase())
      )
      cleanQuery = words.slice(0, 3).join(' ')
    }
  }
  
  return cleanQuery || query
}

// Build research prompt with paper results
function buildResearchPrompt(originalQuery: string, searchResult: any): string {
  const papers = searchResult.papers || []
  
  let prompt = `Based on the research query "${originalQuery}", I found ${papers.length} relevant papers:\n\n`
  
  papers.forEach((paper: any, index: number) => {
    prompt += `${index + 1}. **${paper.title}**\n`
    prompt += `   Authors: ${paper.authors?.map((a: any) => a.name).join(', ') || 'Unknown'}\n`
    prompt += `   Summary: ${paper.summary?.substring(0, 200)}...\n`
    prompt += `   Published: ${new Date(paper.published).toLocaleDateString()}\n`
    prompt += `   PDF: ${paper.pdf_url}\n\n`
  })
  
  prompt += `Please provide a comprehensive summary and analysis of these papers, highlighting key insights and recommendations based on the original query.`
  
  return prompt
}

// Retrieve context from knowledge base using RAG
async function retrieveKnowledgeBaseContext(
  messages: any[], 
  knowledgebaseId: number, 
  event: any
): Promise<string> {
  
  try {
    console.log('[Knowledge Base] Retrieving context for KB:', knowledgebaseId)
    
    // Get knowledge base info
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
    
    // Create embeddings and retriever
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
    
    // Retrieve relevant documents
    const relevantDocs = await retriever.getRelevantDocuments(query)
    
    if (relevantDocs.length === 0) {
      return ''
    }
    
    console.log(`[Knowledge Base] Retrieved ${relevantDocs.length} relevant documents`)
    
    // Format documents as context
    return formatDocumentsAsString(relevantDocs.slice(0, 5)) // Limit to top 5 docs
    
  } catch (error) {
    console.error('[Knowledge Base] Error retrieving context:', error)
    return '' // Return empty context rather than failing the whole request
  }
}

// Format messages for the chat model with optional context
function formatMessagesForModel(messages: any[], context: string = ''): BaseMessage[] {
  const formattedMessages: BaseMessage[] = []
  
  // Add system message with context if available
  if (context) {
    const systemPrompt = `Answer the user's question based on the context below.

Context:
${context}

If the context doesn't contain relevant information to answer the question, you can use your general knowledge, but mention that the answer is not from the provided context.`

    formattedMessages.push(new HumanMessage(systemPrompt))
  }
  
  // Convert messages to LangChain format
  messages.forEach(msg => {
    const content = extractMessageContent(msg)
    
    if (msg.role === 'user') {
      formattedMessages.push(new HumanMessage(content))
    } else if (msg.role === 'assistant') {
      formattedMessages.push(new AIMessage(content))
    }
  })
  
  return formattedMessages
}

// Handle streaming responses
async function handleStreamingResponse(
  messages: BaseMessage[], 
  chatModel: any, 
  event: any
): Promise<any> {
  
  console.log('[Streaming] Setting up streaming response')
  setEventStreamResponse(event)
  
  try {
    const stream = await chatModel.stream(messages)
    
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
          
        } catch (error) {
          console.error('[Streaming] Stream error:', error)
          controller.error(error)
        }
      }
    })
    
    return sendStream(event, readableStream)
    
  } catch (error) {
    console.error('[Streaming] Error setting up stream:', error)
    
    // Fall back to non-streaming response
    const response = await chatModel.invoke(messages)
    return createSuccessResponse(response.content)
  }
}

// Helper functions for response creation
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