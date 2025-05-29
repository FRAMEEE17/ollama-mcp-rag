#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

// Import ArXiv tool 
class ArxivQueryTool {
  private readonly baseUrl = 'http://export.arxiv.org/api/query'
  private readonly userAgent = 'Enterprise-Research-Assistant/1.0'

  constructor() {
    console.error('[ArXiv Tool] Initialized ArXiv query tool')
  }

  async execute(args: any): Promise<any> {
    const startTime = Date.now()
    
    try {
      // Validate input arguments
      const params = {
        query: args.query || '',
        max_results: Math.min(args.max_results || 5, 20),
        sort_by: args.sort_by || 'relevance',
        category: args.category || ''
      }

      console.error('[ArXiv Tool] Executing search with params:', params)

      // Build ArXiv search query
      const searchQuery = this.buildSearchQuery(params.query, params.category)
      const sortOrder = this.mapSortOrder(params.sort_by)

      // Construct API URL
      const url = new URL(this.baseUrl)
      url.searchParams.set('search_query', searchQuery)
      url.searchParams.set('start', '0')
      url.searchParams.set('max_results', params.max_results.toString())
      url.searchParams.set('sortBy', sortOrder)
      url.searchParams.set('sortOrder', 'descending')

      console.error('[ArXiv Tool] Fetching from URL:', url.toString())

      // Make API request
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/atom+xml'
        }
      })

      if (!response.ok) {
        throw new Error(`ArXiv API request failed: ${response.status} ${response.statusText}`)
      }

      const xmlText = await response.text()
      const papers = await this.parseArxivResponse(xmlText)
      
      const result = {
        papers: papers.slice(0, params.max_results),
        total_results: papers.length,
        query: params.query,
        execution_time: Date.now() - startTime
      }

      console.error(`[ArXiv Tool] Found ${result.papers.length} papers in ${result.execution_time}ms`)
      return result

    } catch (error) {
      console.error('[ArXiv Tool] Search failed:', error)
      throw new Error(`ArXiv search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private buildSearchQuery(query: string, category: string): string {
    let searchQuery = query

    // Add category filter if specified
    if (category && category.trim()) {
      searchQuery = `cat:${category.trim()} AND (${query})`
    }

    // Enhance query for better results
    searchQuery = searchQuery
      .replace(/\s+/g, '+')  // Replace spaces with +
      .replace(/[^\w\s+\-\.\:]/g, '') // Remove special characters except +, -, ., :

    return searchQuery
  }

  private mapSortOrder(sortBy: string): string {
    const sortMapping = {
      'relevance': 'relevance',
      'lastUpdated': 'lastUpdatedDate', 
      'submitted': 'submittedDate'
    }
    return sortMapping[sortBy as keyof typeof sortMapping] || 'relevance'
  }

  private async parseArxivResponse(xmlText: string): Promise<any[]> {
    try {
      // Simple XML parsing for ArXiv Atom feed
      const papers: any[] = []
      
      // Extract entries using regex (basic parsing)
      const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || []
      
      for (const entryXml of entryMatches) {
        try {
          const paper = this.parseEntry(entryXml)
          if (paper) {
            papers.push(paper)
          }
        } catch (error) {
          console.error('[ArXiv Tool] Failed to parse entry:', error)
          // Continue with other entries
        }
      }

      return papers
    } catch (error) {
      console.error('[ArXiv Tool] XML parsing failed:', error)
      throw new Error('Failed to parse ArXiv response')
    }
  }

  private parseEntry(entryXml: string): any | null {
    try {
      // Extract basic fields using regex
      const id = this.extractXmlField(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || ''
      const title = this.extractXmlField(entryXml, 'title')?.replace(/\s+/g, ' ').trim() || ''
      const summary = this.extractXmlField(entryXml, 'summary')?.replace(/\s+/g, ' ').trim() || ''
      const published = this.extractXmlField(entryXml, 'published') || ''
      const updated = this.extractXmlField(entryXml, 'updated') || ''

      // Extract authors
      const authorMatches = entryXml.match(/<name>([^<]+)<\/name>/g) || []
      const authors = authorMatches.map(match => ({
        name: match.replace(/<\/?name>/g, '').trim()
      }))

      // Extract categories
      const categoryMatches = entryXml.match(/term="([^"]+)"/g) || []
      const categories = categoryMatches.map(match => 
        match.replace(/term="([^"]+)"/, '$1')
      )

      // Build URLs
      const pdf_url = `http://arxiv.org/pdf/${id}.pdf`
      const abstract_url = `http://arxiv.org/abs/${id}`

      if (!id || !title) {
        return null
      }

      return {
        id,
        title,
        summary,
        authors,
        published,
        updated,
        categories,
        pdf_url,
        abstract_url
      }
    } catch (error) {
      console.error('[ArXiv Tool] Entry parsing error:', error)
      return null
    }
  }

  private extractXmlField(xml: string, fieldName: string): string | null {
    const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i')
    const match = xml.match(regex)
    return match ? match[1].trim() : null
  }
}

// Research server configuration
const SERVER_INFO = {
  name: 'research-server',
  version: '1.0.0',
  description: 'Enterprise Research Assistant MCP Server with ArXiv, Web Scraping, and RAG capabilities'
}

// Environment variables (read from process.env, not passed via MCP config)
const config = {
  arxivEnabled: process.env.ARXIV_API_ENABLED === 'true',
  braveApiKey: process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY,
  researchMode: process.env.RESEARCH_MODE || 'development',
  milvusUrl: process.env.MILVUS_URL,
  memoryNamespace: process.env.MEMORY_NAMESPACE || 'research-assistant'
}

console.error('[Research Server] Configuration:', config)

// Initialize research tools
const arxivTool = new ArxivQueryTool()

class ResearchServer {
  private server: Server
  private tools: Map<string, any> = new Map()

  constructor() {
    this.server = new Server(SERVER_INFO, {
      capabilities: {
        tools: {},
        resources: {}
      }
    })

    this.setupTools()
    this.setupHandlers()
  }

  private setupTools() {
    // Register ArXiv query tool
    this.tools.set('arxiv_query', arxivTool)
    
    console.error('[Research Server] Registered tools:', Array.from(this.tools.keys()))
  }

  private setupHandlers() {
    // List available research tools
    this.server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest) => {
      console.error('[Research Server] Listing tools...')
      
      const tools: Tool[] = [
        {
          name: 'arxiv_query',
          description: 'Search and retrieve academic papers from ArXiv repository. Supports keyword search, author lookup, and paper retrieval by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for ArXiv papers (keywords, authors, titles)'
              },
              max_results: {
                type: 'number',
                description: 'Maximum number of papers to retrieve (default: 5, max: 20)',
                default: 5
              },
              sort_by: {
                type: 'string',
                enum: ['relevance', 'lastUpdated', 'submitted'],
                description: 'Sort papers by relevance, last updated, or submission date',
                default: 'relevance'
              },
              category: {
                type: 'string',
                description: 'ArXiv category filter (e.g., cs.AI, cs.LG, stat.ML)',
                default: ''
              }
            },
            required: ['query']
          }
        }
      ]

      return { tools }
    })

    // Execute research tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params
      
      console.error(`[Research Server] Executing tool: ${name} with args:`, args)

      try {
        const tool = this.tools.get(name)
        if (!tool) {
          throw new Error(`Unknown research tool: ${name}`)
        }

        const result = await tool.execute(args)
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      } catch (error) {
        console.error(`[Research Server] Tool execution error:`, error)
        
        return {
          content: [
            {
              type: 'text', 
              text: `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ],
          isError: true
        }
      }
    })
  }

  async start() {
    const transport = new StdioServerTransport()
    console.error('[Research Server] Starting server...')
    
    await this.server.connect(transport)
    console.error('[Research Server] Server started successfully')
  }
}

// Start the research server
async function main() {
  try {
    const server = new ResearchServer()
    await server.start()
  } catch (error) {
    console.error('[Research Server] Failed to start:', error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('[Research Server] Shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.error('[Research Server] Shutting down gracefully...')
  process.exit(0)
})

if (require.main === module) {
  main().catch(console.error)
}