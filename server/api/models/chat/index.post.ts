// server/api/models/chat/index.post.ts
// Replace the imports section at the top

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
import { AIMessage, AIMessageChunk, AIMessageFields, BaseMessage, BaseMessageChunk, BaseMessageLike, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { resolveCoreference } from '~/server/coref'
import { concat } from "@langchain/core/utils/stream"
import { MODEL_FAMILIES } from '~/config'
// UPDATED: Import Direct MCP service instead of LangChain adapter
import { MCPService } from '@/server/utils/mcp'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ChatOllama } from '@langchain/ollama'
import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

// Keep all your existing interfaces unchanged...
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

interface ToolCallResult {
  content?: string
  [key: string]: any
}

// UPDATED: Simplified MCP Connection Pool using Direct MCP
class McpConnectionPool {
  private static instance: McpConnectionPool
  private directMcp: MCPService | null = null
  private isInitialized = false
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

    try {
      console.log('[MCP Pool] Initializing Direct MCP connection...')
      
      this.directMcp = new MCPService()
      this.isInitialized = true
      this.lastHealthCheck = Date.now()
      
      console.log(`[MCP Pool] Direct MCP initialized successfully`)
    } catch (error) {
      console.error('[MCP Pool] ❌ Initialization failed:', error)
      this.isInitialized = false
      throw error
    }
  }

  // Mock tools for compatibility with existing code
  getTools(): StructuredToolInterface[] {
    if (!this.isInitialized) {
      return []
    }
    // Return mock tool for compatibility
    return [{
      name: 'arxiv_query',
      description: 'Search ArXiv for research papers',
      schema: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          max_results: { type: 'number' }
        }
      },
      invoke: async (args: any) => {
        if (!this.directMcp) throw new Error('Direct MCP not initialized')
        const query = args.keywords?.[0] || args.query || 'machine learning'
        return await this.directMcp.searchArxiv(query, args.max_results || 5)
      }
    } as any]
  }

  getToolsMap(): Record<string, StructuredToolInterface> {
    const tools = this.getTools()
    return tools.reduce((acc, tool) => {
      acc[tool.name] = tool
      return acc
    }, {} as Record<string, StructuredToolInterface>)
  }

  async executeTool(toolName: string, args: any): Promise<any> {
    if (!this.directMcp) {
      throw new Error('Direct MCP not initialized')
    }
    
    console.log(`[MCP Pool] Executing Direct MCP tool: ${toolName}`)
    
    if (toolName === 'arxiv_query') {
      const query = args.keywords?.[0] || args.query || 'machine learning'
      const result = await this.directMcp.searchArxiv(query, args.max_results || 5)
      console.log(`[MCP Pool] ✅ Direct MCP tool completed`)
      return result
    }
    
    throw new Error(`Tool ${toolName} not found`)
  }

  isHealthy(): boolean {
    const now = Date.now()
    if (now - this.lastHealthCheck > this.healthCheckInterval) {
      this.lastHealthCheck = now
      return this.isInitialized && this.directMcp !== null
    }
    return this.isInitialized && this.directMcp !== null
  }

  async cleanup(): Promise<void> {
    console.log('[MCP Pool] 🧹 Cleaning up Direct MCP...')
    this.directMcp = null
    this.isInitialized = false
  }

  getStats() {
    return {
      initialized: this.isInitialized,
      toolCount: this.isInitialized ? 1 : 0,
      toolNames: this.isInitialized ? ['arxiv_query'] : [],
      lastHealthCheck: new Date(this.lastHealthCheck).toISOString()
    }
  }
}

// Keep all your existing helper functions unchanged...
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

const serializeMessages = (messages: RequestBody['messages']): string =>
  messages.map((message) => {
    if (Array.isArray(message.content)) {
      const textParts = message.content
        .filter((part): part is MessageContent & { text: string } =>
          part.type === 'text' && typeof part.text === 'string'
        )
        .map(part => part.text)
        .join(' ')
      return `${message.role}: ${textParts}`
    }
    return `${message.role}: ${message.content}`
  }).join("\n")

const transformMessages = (messages: RequestBody['messages']): BaseMessage[] => {
  console.log('[Transform] Input messages:', messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.substring(0, 50) + '...' : 'multimodal' })))
  
  const transformed = messages
    .filter(message => {
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
      let content = ''
      if (Array.isArray(message.content)) {
        content = message.content
          .filter(part => part.type === 'text' && part.text)
          .map(part => part.text)
          .join(' ')
      } else {
        content = (message.content as string) || ''
      }

      if (!content.trim()) {
        console.warn('[Transform] Empty content for message role:', message.role)
        content = 'Please respond.'
      }

      if (message.role === 'user') {
        return new HumanMessage(content.trim())
      } else if (message.role === 'assistant') {
        return new AIMessage(content.trim())
      } else {
        return new HumanMessage(content.trim())
      }
    })
  
  console.log('[Transform] Output messages:', transformed.map(m => ({ type: m._getType(), content: m.content.toString().substring(0, 50) + '...' })))
  return transformed
}

const normalizeMessages = (messages: RequestBody['messages']): BaseMessage[] => {
  const normalizedMessages = []
  for (const message of messages) {
    if (message.toolResult) {
      normalizedMessages.push(new ToolMessage(message.content as string, message.toolCallId!))
    } else if (message.role === "user") {
      if (Array.isArray(message.content)) {
        normalizedMessages.push(new HumanMessage({ content: message.content }))
      } else {
        normalizedMessages.push(new HumanMessage(message.content))
      }
    } else if (message.role === "assistant") {
      normalizedMessages.push(new AIMessage(message.content as string))
    }
  }
  return normalizedMessages
}

const convertResultToString = (result: any): string => {
  if (typeof result === 'string') {
    return result
  }
  if (result && typeof result === 'object') {
    if (result.content) return result.content
    if (result.text) return result.text
    if (result.message) return result.message
    if (result.data) return JSON.stringify(result.data)
    
    // UPDATED: Handle Direct MCP ArXiv results
    if (result.success && result.papers) {
      const papers = result.papers
      let formattedResult = `Found ${papers.length} research papers:\n\n`
      
      papers.forEach((paper: any, index: number) => {
        formattedResult += `**${index + 1}. ${paper.title}**\n`
        formattedResult += `📝 **Abstract**: ${paper.summary.substring(0, 200)}...\n`
        formattedResult += `👥 **Authors**: ${paper.authors.map((a: any) => a.name).join(', ')}\n`
        formattedResult += `📅 **Published**: ${new Date(paper.published).toLocaleDateString()}\n`
        formattedResult += `🔗 **PDF**: ${paper.pdf_url}\n`
        formattedResult += `📄 **ArXiv**: ${paper.abstract_url}\n\n`
      })
      
      return formattedResult
    }
    
    return JSON.stringify(result, null, 2)
  }
  return String(result)
}

const generateToolCallId = (toolName?: string): string => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substr(2, 9)
  return `${toolName || 'tool'}_${timestamp}_${random}`
}

const extractUserQuery = (content: string | MessageContent[]): string => {
  if (Array.isArray(content)) {
    return content
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text)
      .join(' ') || ''
  }
  return (content as string) || ''
}

const modelSupportsTools = (family: string): boolean => {
  const supportedFamilies = ['openai', 'anthropic', 'ollama']
  return supportedFamilies.includes(family.toLowerCase())
}

// UPDATED: Simplified manual tool calling with Direct MCP
const handleManualToolCalling = async (
  userMessage: string, 
  toolsMap: Record<string, StructuredToolInterface>,
  mcpPool: McpConnectionPool
): Promise<string | null> => {
  
  console.log("[Manual Tool] 🔍 Analyzing message:", userMessage)
  
  if (!userMessage || userMessage.trim() === '') {
    console.log("[Manual Tool] ❌ Empty user message received")
    return null
  }
  
  const researchKeywords = [
    'paper', 'papers', 'research', 'arxiv', 'study', 'studies', 'publication', 'publications',
    'find', 'search', 'recommend', 'suggest', 'help', 'show', 'get', 'about', 'on',
    'machine learning', 'deep learning', 'artificial intelligence', 'neural network',
    'computer science', 'algorithm', 'model', 'method', 'technique', 'approach',
    'เปเปอร์', 'งานวิจัย', 'บทความวิจัย', 'หาเปเปอร์', 'แนะนำเปเปอร์', 'แนะนำ', 
    'ช่วย', 'หา', 'ค้นหา', 'เกี่ยวกับ', 'เกี่ยวข้องกับ', 'หน่อย', 'ครับ', 'ค่ะ',
    'วิจัย', 'การศึกษา', 'บทความ', 'เอกสาร', 'การเรียนรู้ของเครื่อง', 'ปัญญาประดิษฐ์'
  ]
  
  const messageLower = userMessage.toLowerCase()
  const isResearchQuery = researchKeywords.some(keyword => 
    messageLower.includes(keyword.toLowerCase())
  )
  
  console.log("[Manual Tool] Is research query:", isResearchQuery)
  console.log("[Manual Tool] Available tools:", Object.keys(toolsMap))
  
  if (isResearchQuery && Object.keys(toolsMap).length > 0) {
    try {
      console.log('[Manual Tool] Detected research query, using Direct MCP ArXiv tool')
      
      let searchQuery = userMessage
        .replace(/ช่วย|แนะนำ|หา|ค้นหา|เกี่ยวกับ|เกี่ยวข้องกับ|หน่อย|ครับ|ค่ะ/gi, '')
        .replace(/please|find|search|recommend|help|show|me|some|about|on|papers?|research/gi, '')
        .replace(/เปเปอร์|งานวิจัย|บทความวิจัย|วิจัย|การศึกษา|บทความ/gi, '')
        .replace(/paper|papers|research|publication|study|studies/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
      
      if (searchQuery.length < 3) {
        const technicalTerms = userMessage.match(/machine learning|deep learning|artificial intelligence|neural network|computer science|การเรียนรู้ของเครื่อง|ปัญญาประดิษฐ์/gi)
        if (technicalTerms && technicalTerms.length > 0) {
          searchQuery = technicalTerms[0]
        } else {
          searchQuery = userMessage
        }
      }
      
      console.log('[Manual Tool] Final search query:', searchQuery)
      
      const arxivResult = await mcpPool.executeTool('arxiv_query', { 
        keywords: [searchQuery],
        max_results: 5
      })
      
      const resultContent = convertResultToString(arxivResult)
      
      const isThai = /[ก-๙]/.test(userMessage)
      if (isThai) {
        return `ผมค้นหาเปเปอร์ที่เกี่ยวข้องกับ "${searchQuery}" ให้แล้วครับ:\n\n${resultContent}`
      } else {
        return `I found research papers related to "${searchQuery}":\n\n${resultContent}`
      }
      
    } catch (error) {
      console.error('[Manual Tool] ❌ Direct MCP ArXiv tool failed:', error)
      const isThai = /[ก-๙]/.test(userMessage)
      if (isThai) {
        return `เกิดข้อผิดพลาดในการค้นหาเปเปอร์: ${error instanceof Error ? error.message : 'Unknown error'}`
      } else {
        return `Error searching for papers: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
  
  console.log("[Manual Tool] ❌ No matching tools found")
  return null
}

