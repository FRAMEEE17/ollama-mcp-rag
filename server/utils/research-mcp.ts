import { McpService } from '@/server/utils/mcp'
import { type StructuredToolInterface } from "@langchain/core/tools"
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'

// Import research tool schemas
import {
  ArxivQueryInputSchema,
  HybridSearchInputSchema,
  WebScraperInputSchema,
  BraveSearchInputSchema,
  type ArxivSearchResult,
  type HybridSearchResult,
  type ScrapedContent,
  type BraveSearchResponse
} from '../../mcp/schemas/research-tools'

interface ResearchMcpConfig {
  enabled: boolean
  timeout: number
  maxRetries: number
  tools: string[]
}

interface ToolExecutionResult {
  success: boolean
  data?: any
  error?: string
  execution_time: number
  tool_name: string
}

export class ResearchMcpService extends McpService {
  private config: ResearchMcpConfig
  private researchTools: Map<string, StructuredToolInterface> = new Map()
  private executionStats: Map<string, { count: number; avg_time: number }> = new Map()

  constructor(config?: Partial<ResearchMcpConfig>) {
    super()
    
    this.config = {
      enabled: true,
      timeout: 30000,
      maxRetries: 3,
      tools: ['arxiv_query', 'web_scraper', 'hybrid_search', 'brave_search'],
      ...config
    }

    console.log('[Research MCP] Initializing with config:', this.config)
    this.initializeResearchTools()
  }

  private initializeResearchTools() {
    if (!this.config.enabled) {
      console.log('[Research MCP] Service disabled, skipping tool initialization')
      return
    }

    try {
      // Initialize ArXiv Query Tool
      if (this.config.tools.includes('arxiv_query')) {
        const arxivTool = tool(
          async (input: z.infer<typeof ArxivQueryInputSchema>): Promise<ArxivSearchResult> => {
            return await this.executeResearchTool('arxiv_query', input)
          },
          {
            name: 'arxiv_query',
            description: 'Search and retrieve academic papers from ArXiv repository. Supports keyword search, author lookup, and category filtering.',
            schema: ArxivQueryInputSchema
          }
        )
        this.researchTools.set('arxiv_query', arxivTool)
      }

      // Initialize Hybrid Search Tool  
      if (this.config.tools.includes('hybrid_search')) {
        const hybridSearchTool = tool(
          async (input: z.infer<typeof HybridSearchInputSchema>): Promise<HybridSearchResult> => {
            return await this.executeResearchTool('hybrid_search', input)
          },
          {
            name: 'hybrid_search',
            description: 'Perform multi-collection semantic and keyword search across research databases with advanced reranking.',
            schema: HybridSearchInputSchema
          }
        )
        this.researchTools.set('hybrid_search', hybridSearchTool)
      }

      // Initialize Web Scraper Tool
      if (this.config.tools.includes('web_scraper')) {
        const webScraperTool = tool(
          async (input: z.infer<typeof WebScraperInputSchema>): Promise<ScrapedContent> => {
            return await this.executeResearchTool('web_scraper', input)
          },
          {
            name: 'web_scraper',
            description: 'Extract content, metadata, and links from web pages using advanced browser automation.',
            schema: WebScraperInputSchema
          }
        )
        this.researchTools.set('web_scraper', webScraperTool)
      }

      // Initialize Enhanced Brave Search Tool
      if (this.config.tools.includes('brave_search')) {
        const braveSearchTool = tool(
          async (input: z.infer<typeof BraveSearchInputSchema>): Promise<BraveSearchResponse> => {
            return await this.executeResearchTool('brave_search', input)
          },
          {
            name: 'brave_search_enhanced',
            description: 'Enhanced real-time web search with filtering, freshness control, and domain management.',
            schema: BraveSearchInputSchema
          }
        )
        this.researchTools.set('brave_search_enhanced', braveSearchTool)
      }

      console.log(`[Research MCP] Initialized ${this.researchTools.size} research tools`)
    } catch (error) {
      console.error('[Research MCP] Failed to initialize research tools:', error)
    }
  }

  /**
   * Execute a research tool through the MCP server
   */
  private async executeResearchTool(toolName: string, input: any): Promise<any> {
    const startTime = Date.now()
    
    try {
      console.log(`[Research MCP] Executing ${toolName} with input:`, input)

      // Get available MCP tools from base service
      const mcpTools = await this.listTools()
      const researchTool = mcpTools.find(tool => tool.name === toolName)
      
      if (!researchTool) {
        throw new Error(`Research tool '${toolName}' not found in MCP server`)
      }

      // Execute tool through MCP client
      const result = await researchTool.invoke(input)
      
      const executionTime = Date.now() - startTime
      this.updateExecutionStats(toolName, executionTime)
      
      console.log(`[Research MCP] ${toolName} completed in ${executionTime}ms`)
      
      return {
        success: true,
        data: result,
        execution_time: executionTime,
        tool_name: toolName
      }
      
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`[Research MCP] ${toolName} failed after ${executionTime}ms:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_time: executionTime,
        tool_name: toolName
      }
    }
  }

  /**
   * Get all available research tools (base MCP + research-specific)
   */
  async listResearchTools(): Promise<StructuredToolInterface[]> {
    try {
      // Get base MCP tools
      const baseMcpTools = await super.listTools()
      
      // Combine with research-specific tools
      const researchToolsArray = Array.from(this.researchTools.values())
      
      console.log(`[Research MCP] Available tools: ${baseMcpTools.length} base + ${researchToolsArray.length} research`)
      
      return [...baseMcpTools, ...researchToolsArray]
    } catch (error) {
      console.error('[Research MCP] Failed to list research tools:', error)
      return Array.from(this.researchTools.values())
    }
  }

  /**
   * Execute research query using multiple tools
   */
  async executeResearchQuery(query: string, context?: any): Promise<ToolExecutionResult> {
    const startTime = Date.now()
    
    try {
      console.log(`[Research MCP] Executing research query: "${query}"`)
      
      // Determine which tools to use based on query
      const toolsToUse = this.selectToolsForQuery(query)
      console.log(`[Research MCP] Selected tools:`, toolsToUse)
      
      const results: any[] = []
      
      // Execute tools in parallel for better performance
      const toolPromises = toolsToUse.map(async (toolName) => {
        try {
          switch (toolName) {
            case 'arxiv_query':
              return await this.executeResearchTool('arxiv_query', {
                query,
                max_results: 5,
                sort_by: 'relevance'
              })
              
            case 'brave_search':
              return await this.executeResearchTool('brave_search', {
                query,
                count: 5,
                search_type: 'web'
              })
              
            case 'hybrid_search':
              return await this.executeResearchTool('hybrid_search', {
                query,
                collections: ['academic-papers'],
                max_results: 10
              })
              
            default:
              console.warn(`[Research MCP] Unknown tool: ${toolName}`)
              return null
          }
        } catch (error) {
          console.error(`[Research MCP] Tool ${toolName} failed:`, error)
          return null
        }
      })
      
      const toolResults = await Promise.all(toolPromises)
      const validResults = toolResults.filter(result => result !== null)
      
      const executionTime = Date.now() - startTime
      
      return {
        success: true,
        data: {
          query,
          results: validResults,
          tools_used: toolsToUse,
          context
        },
        execution_time: executionTime,
        tool_name: 'research_query'
      }
      
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error('[Research MCP] Research query failed:', error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Research query failed',
        execution_time: executionTime,
        tool_name: 'research_query'
      }
    }
  }

  /**
   * Intelligent tool selection based on query analysis
   */
  private selectToolsForQuery(query: string): string[] {
    const tools: string[] = []
    const queryLower = query.toLowerCase()
    
    // Check for academic research indicators
    const academicKeywords = ['paper', 'research', 'study', 'arxiv', 'academic', 'publication', 'journal']
    if (academicKeywords.some(keyword => queryLower.includes(keyword))) {
      tools.push('arxiv_query')
    }
    
    // Check for web search indicators
    const webKeywords = ['news', 'current', 'latest', 'today', 'recent', 'website', 'company']
    if (webKeywords.some(keyword => queryLower.includes(keyword))) {
      tools.push('brave_search')
    }
    
    // Always include hybrid search if available
    if (this.config.tools.includes('hybrid_search')) {
      tools.push('hybrid_search')
    }
    
    // Default to brave search if no specific tools selected
    if (tools.length === 0) {
      tools.push('brave_search')
    }
    
    return tools
  }

  /**
   * Update execution statistics for monitoring
   */
  private updateExecutionStats(toolName: string, executionTime: number) {
    const stats = this.executionStats.get(toolName) || { count: 0, avg_time: 0 }
    stats.count += 1
    stats.avg_time = (stats.avg_time * (stats.count - 1) + executionTime) / stats.count
    this.executionStats.set(toolName, stats)
  }

  /**
   * Get execution statistics for monitoring
   */
  getExecutionStats(): Record<string, { count: number; avg_time: number }> {
    const stats: Record<string, { count: number; avg_time: number }> = {}
    this.executionStats.forEach((value, key) => {
      stats[key] = value
    })
    return stats
  }

  /**
   * Health check for research MCP service
   */
  async healthCheck(): Promise<{ status: string; tools: number; stats: any }> {
    try {
      const tools = await this.listResearchTools()
      const baseStatus = super.getStatus()
      
      return {
        status: 'healthy',
        tools: tools.length,
        stats: {
          ...baseStatus,
          execution_stats: this.getExecutionStats(),
          config: this.config
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        tools: 0,
        stats: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[Research MCP] Shutting down research service...')
    
    // Close base MCP service
    await super.close()
    
    // Clear research tools
    this.researchTools.clear()
    this.executionStats.clear()
    
    console.log('[Research MCP] Shutdown complete')
  }
}