import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

interface ArxivSearchResult {
  success: boolean
  papers?: ArxivPaper[]
  error?: string
  total_results?: number
  execution_time?: number
}

interface ArxivPaper {
  id: string
  title: string
  summary: string
  authors: Array<{ name: string }>
  published: string
  updated: string
  categories: string[]
  pdf_url: string
  abstract_url: string
  relevance_score?: number
  keyword_matches?: string[]
  age_days?: number
}

/**
 * Enhanced MCP Service with robust error handling and connection management
 * This service provides a reliable interface to the MCP research server
 */
export class MCPService {
  private serverPath: string
  private isServerAvailable: boolean = false
  private activeProcesses: Set<ChildProcess> = new Set()
  private connectionTimeout: number = 30000 // 30 seconds
  private requestTimeout: number = 45000 // 45 seconds

  constructor() {
    this.serverPath = './mcp/servers/research-server.cjs'
    this.checkServerAvailability()
  }

  /**
   * Comprehensive server availability check
   */
  private checkServerAvailability(): void {
    try {
      // Check if the compiled MCP server exists
      const serverExists = fs.existsSync(this.serverPath)
      
      if (serverExists) {
        // Also check if it's a valid JavaScript file
        const stats = fs.statSync(this.serverPath)
        this.isServerAvailable = stats.isFile() && stats.size > 0
        
        if (this.isServerAvailable) {
          console.log('[MCP Service] Research server found and ready:', this.serverPath)
        } else {
          console.warn('[MCP Service] Research server file is invalid or empty:', this.serverPath)
        }
      } else {
        console.warn('[MCP Service] Research server not found at:', this.serverPath)
        this.isServerAvailable = false
      }
    } catch (error) {
      console.error('[MCP Service] Error checking server availability:', error)
      this.isServerAvailable = false
    }
  }

  /**
   * Enhanced ArXiv search with comprehensive error handling and retry logic
   */
  async searchArxiv(query: string, maxResults: number = 5): Promise<ArxivSearchResult> {
    console.log(`[MCP Service] Searching ArXiv for: "${query}" (max: ${maxResults})`)
    
    if (!this.isServerAvailable) {
      console.error('[MCP Service] Server not available, attempting fallback...')
      return await this.fallbackArxivSearch(query, maxResults)
    }

    const startTime = Date.now()
    let serverProcess: ChildProcess | null = null
    
    try {
      // Create the server process with enhanced error handling
      serverProcess = this.createServerProcess()
      
      if (!serverProcess || !serverProcess.stdin || !serverProcess.stdout) {
        throw new Error('Failed to create server process with required streams')
      }

      // Set up comprehensive process monitoring
      const { responses, errorLogs } = this.setupProcessMonitoring(serverProcess)
      
      // Wait for server initialization with timeout
      await this.waitForServerReady(serverProcess, errorLogs)
      
      console.log('[MCP Service] Server ready, executing search...')

      // Execute the search workflow
      const searchResult = await this.executeSearchWorkflow(
        serverProcess, 
        query, 
        maxResults, 
        responses
      )
      
      const executionTime = Date.now() - startTime
      console.log(`[MCP Service] Search completed in ${executionTime}ms`)
      
      return {
        ...searchResult,
        execution_time: executionTime
      }

    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error('[MCP Service] Search failed:', error)
      
      // Try fallback search if main search fails
      if (error instanceof Error && error.message.includes('timeout')) {
        console.log('[MCP Service] Attempting fallback due to timeout...')
        return await this.fallbackArxivSearch(query, maxResults)
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        papers: [],
        execution_time: executionTime
      }
      
    } finally {
      // Clean up the server process
      if (serverProcess) {
        this.cleanupProcess(serverProcess)
      }
    }
  }

  /**
   * Create and configure the MCP server process
   */
  private createServerProcess(): ChildProcess {
    const serverProcess = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: this.connectionTimeout
    })

    // Add to active processes for cleanup
    this.activeProcesses.add(serverProcess)
    
    // Handle process errors
    serverProcess.on('error', (error) => {
      console.error('[MCP Service] Process error:', error)
    })
    
    serverProcess.on('exit', (code, signal) => {
      console.log(`[MCP Service] Process exited with code ${code}, signal ${signal}`)
      this.activeProcesses.delete(serverProcess)
    })

    return serverProcess
  }

  /**
   * Set up comprehensive monitoring for the server process
   */
  private setupProcessMonitoring(serverProcess: ChildProcess): {
    responses: string[]
    errorLogs: string[]
  } {
    const responses: string[] = []
    const errorLogs: string[] = []

    // Monitor stdout for responses
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      responses.push(output)
      
      // Log responses for debugging (but not too verbose)
      if (output.includes('"id"') || output.includes('error')) {
        console.log('[MCP Service] Received response:', output.substring(0, 200) + '...')
      }
    })

    // Monitor stderr for server logs and status
    serverProcess.stderr?.on('data', (data) => {
      const log = data.toString().trim()
      errorLogs.push(log)
      
      // Log important server messages
      if (log.includes('Enhanced server started') || 
          log.includes('Error') || 
          log.includes('Failed')) {
        console.log('[MCP Service]', log)
      }
    })

    return { responses, errorLogs }
  }

  /**
   * Wait for the server to be ready with enhanced timeout handling
   */
  private async waitForServerReady(
    serverProcess: ChildProcess, 
    errorLogs: string[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      
      const checkReady = () => {
        // Check if server reported ready
        const isReady = errorLogs.some(log => 
          log.includes('Enhanced server started successfully') ||
          log.includes('server started')
        )
        
        if (isReady) {
          resolve()
          return
        }
        
        // Check for timeout
        if (Date.now() - startTime > this.connectionTimeout) {
          reject(new Error('Server startup timeout'))
          return
        }
        
        // Check if process is still alive
        if (serverProcess.killed || serverProcess.exitCode !== null) {
          reject(new Error('Server process died during startup'))
          return
        }
        
        // Continue checking
        setTimeout(checkReady, 100)
      }
      
      // Start checking after a brief delay
      setTimeout(checkReady, 500)
    })
  }

  /**
   * Execute the complete MCP search workflow
   */
  private async executeSearchWorkflow(
    serverProcess: ChildProcess,
    query: string,
    maxResults: number,
    responses: string[]
  ): Promise<ArxivSearchResult> {
    
    // Step 1: Initialize MCP connection
    await this.sendMCPMessage(serverProcess, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-client", version: "1.0.0" }
      }
    })
    
    // Wait for initialization response
    await this.waitForResponse(responses, '"id":1', 5000)
    
    // Step 2: Execute ArXiv search
    await this.sendMCPMessage(serverProcess, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "arxiv_query",
        arguments: {
          keywords: [query],
          max_results: maxResults,
          sort_by: "relevance"
        }
      }
    })
    
    // Wait for search response with longer timeout
    await this.waitForResponse(responses, '"id":2', this.requestTimeout)
    
    // Step 3: Parse and return results
    return this.parseSearchResponse(responses)
  }

  /**
   * Send a message to the MCP server with error handling
   */
  private async sendMCPMessage(
    serverProcess: ChildProcess,
    message: any
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!serverProcess.stdin) {
        reject(new Error('Server stdin not available'))
        return
      }
      
      try {
        const messageStr = JSON.stringify(message) + '\n'
        console.log(`[MCP Service] Sending: ${message.method} (id: ${message.id})`)
        
        serverProcess.stdin.write(messageStr, (error) => {
          if (error) {
            reject(new Error(`Failed to send message: ${error.message}`))
          } else {
            resolve()
          }
        })
      } catch (error) {
        reject(new Error(`Message serialization failed: ${error}`))
      }
    })
  }

  /**
   * Wait for a specific response with timeout
   */
  private async waitForResponse(
    responses: string[],
    expectedPattern: string,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      
      const checkResponse = () => {
        // Check if we have the expected response
        const hasResponse = responses.some(response => 
          response.includes(expectedPattern)
        )
        
        if (hasResponse) {
          resolve()
          return
        }
        
        // Check for timeout
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Response timeout waiting for: ${expectedPattern}`))
          return
        }
        
        // Continue checking
        setTimeout(checkResponse, 100)
      }
      
      checkResponse()
    })
  }

  /**
   * Parse the search response from MCP server
   */
  private parseSearchResponse(responses: string[]): ArxivSearchResult {
    try {
      // Find the search result response (id: 2)
      for (const response of responses) {
        if (!response.includes('"id":2')) continue
        
        try {
          const parsed = JSON.parse(response)
          
          if (parsed.result?.content?.[0]?.text) {
            const resultText = parsed.result.content[0].text
            const searchResult = JSON.parse(resultText)
            
            if (searchResult.success && searchResult.papers) {
              return {
                success: true,
                papers: searchResult.papers,
                total_results: searchResult.papers.length,
                execution_time: searchResult.execution_time || 0
              }
            } else {
              return {
                success: false,
                error: searchResult.error || 'No papers found',
                papers: []
              }
            }
          }
        } catch (parseError) {
          console.warn('[MCP Service] Failed to parse response:', parseError)
          continue
        }
      }
      
      // If no valid response found, check for errors
      const errorResponse = responses.find(r => r.includes('error'))
      if (errorResponse) {
        try {
          const parsed = JSON.parse(errorResponse)
          return {
            success: false,
            error: parsed.error?.message || 'Server error',
            papers: []
          }
        } catch {
          return {
            success: false,
            error: 'Server returned an error',
            papers: []
          }
        }
      }
      
      return {
        success: false,
        error: 'No valid response received from server',
        papers: []
      }
      
    } catch (error) {
      console.error('[MCP Service] Response parsing failed:', error)
      return {
        success: false,
        error: 'Failed to parse server response',
        papers: []
      }
    }
  }

  /**
   * Fallback ArXiv search using direct API when MCP fails
   */
  private async fallbackArxivSearch(query: string, maxResults: number): Promise<ArxivSearchResult> {
    console.log('[MCP Service] Using fallback ArXiv search...')
    const startTime = Date.now()
    
    try {
      // Build direct ArXiv API URL
      const searchQuery = encodeURIComponent(query.replace(/\s+/g, '+'))
      const apiUrl = `http://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`
      
      console.log('[MCP Service] Fallback URL:', apiUrl)
      
      // Make direct API call with timeout
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Enterprise-Research-Assistant/1.0',
          'Accept': 'application/atom+xml'
        },
        signal: AbortSignal.timeout(15000)
      })
      
      if (!response.ok) {
        throw new Error(`ArXiv API returned ${response.status}: ${response.statusText}`)
      }
      
      const xmlText = await response.text()
      const papers = this.parseArxivXML(xmlText)
      
      const executionTime = Date.now() - startTime
      
      return {
        success: true,
        papers: papers.slice(0, maxResults),
        total_results: papers.length,
        execution_time: executionTime
      }
      
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error('[MCP Service] Fallback search failed:', error)
      
      return {
        success: false,
        error: `Fallback search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        papers: [],
        execution_time: executionTime
      }
    }
  }

  /**
   * Parse ArXiv XML response (simplified version for fallback)
   */
  private parseArxivXML(xmlText: string): ArxivPaper[] {
    const papers: ArxivPaper[] = []
    
    try {
      // Extract entries using regex (basic XML parsing)
      const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || []
      
      for (const entryXml of entryMatches) {
        try {
          const paper = this.parseArxivEntry(entryXml)
          if (paper) {
            papers.push(paper)
          }
        } catch (error) {
          console.warn('[MCP Service] Failed to parse entry:', error)
        }
      }
      
    } catch (error) {
      console.error('[MCP Service] XML parsing failed:', error)
    }
    
    return papers
  }

  /**
   * Parse individual ArXiv entry
   */
  private parseArxivEntry(entryXml: string): ArxivPaper | null {
    try {
      const extractField = (fieldName: string): string => {
        const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i')
        const match = entryXml.match(regex)
        return match ? match[1].trim() : ''
      }
      
      const id = extractField('id').replace('http://arxiv.org/abs/', '')
      const title = extractField('title').replace(/\s+/g, ' ').trim()
      const summary = extractField('summary').replace(/\s+/g, ' ').trim()
      const published = extractField('published')
      const updated = extractField('updated')
      
      // Extract authors
      const authorMatches = entryXml.match(/<name>([^<]+)<\/name>/g) || []
      const authors = authorMatches.map(match => ({
        name: match.replace(/<\/?name>/g, '').trim()
      }))
      
      // Extract categories
      const categoryMatches = entryXml.match(/<category[^>]+term="([^"]+)"/g) || []
      const categories = categoryMatches.map(match => {
        const termMatch = match.match(/term="([^"]+)"/)
        return termMatch ? termMatch[1] : ''
      }).filter(cat => cat)
      
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
        pdf_url: `http://arxiv.org/pdf/${id}.pdf`,
        abstract_url: `http://arxiv.org/abs/${id}`,
        age_days: Math.floor((Date.now() - new Date(published).getTime()) / (1000 * 60 * 60 * 24))
      }
      
    } catch (error) {
      console.error('[MCP Service] Entry parsing failed:', error)
      return null
    }
  }

  /**
   * Clean up server process
   */
  private cleanupProcess(serverProcess: ChildProcess): void {
    try {
      if (!serverProcess.killed) {
        serverProcess.kill('SIGTERM')
        
        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          if (!serverProcess.killed) {
            console.warn('[MCP Service] Force killing server process')
            serverProcess.kill('SIGKILL')
          }
        }, 2000)
      }
      
      this.activeProcesses.delete(serverProcess)
    } catch (error) {
      console.error('[MCP Service] Error cleaning up process:', error)
    }
  }

  /**
   * Get service status for monitoring
   */
  getStatus(): any {
    return {
      isServerAvailable: this.isServerAvailable,
      serverPath: this.serverPath,
      activeProcesses: this.activeProcesses.size,
      lastCheck: new Date().toISOString(),
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout
    }
  }

  /**
   * Update service configuration
   */
  updateConfig(config: { connectionTimeout?: number; requestTimeout?: number }): void {
    if (config.connectionTimeout) {
      this.connectionTimeout = config.connectionTimeout
    }
    if (config.requestTimeout) {
      this.requestTimeout = config.requestTimeout
    }
    console.log('[MCP Service] Configuration updated:', config)
  }

  /**
   * Test MCP server connectivity
   */
  async testConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const startTime = Date.now()
    
    try {
      // Quick connection test with minimal query
      const result = await this.searchArxiv('test', 1)
      const latency = Date.now() - startTime
      
      return {
        success: result.success,
        error: result.error,
        latency
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        latency: Date.now() - startTime
      }
    }
  }

  /**
   * Clean up resources and close all connections
   */
  async close(): Promise<void> {
    console.log('[MCP Service] Closing service and cleaning up resources...')
    
    // Clean up all active processes
    for (const process of this.activeProcesses) {
      this.cleanupProcess(process)
    }
    
    // Wait a bit for processes to terminate gracefully
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Clear the set
    this.activeProcesses.clear()
    
    console.log('[MCP Service] Service closed successfully')
  }
}

// Export a singleton instance for consistency across the application
let mcpServiceInstance: MCPService | null = null

export function getMcpService(): MCPService {
  if (!mcpServiceInstance) {
    mcpServiceInstance = new MCPService()
  }
  return mcpServiceInstance
}

// Export for direct instantiation when needed
export { MCPService as default }