// server/utils/mcp.ts
import { spawn } from 'child_process'
import fs from 'fs'

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
 * Simplified MCP Service that directly executes the research server
 * This approach avoids the complexity of managing multiple protocol layers
 */
export class MCPService {
  private serverPath: string
  private isServerAvailable: boolean = false

  constructor() {
    this.serverPath = './mcp/servers/research-server.cjs'
    this.checkServerAvailability()
  }

  /**
   * Check if the MCP server file exists and is accessible
   */
  private checkServerAvailability(): void {
    try {
      this.isServerAvailable = fs.existsSync(this.serverPath)
      if (this.isServerAvailable) {
        console.log('[MCP Service] Research server found at:', this.serverPath)
      } else {
        console.warn('[MCP Service] Research server not found at:', this.serverPath)
      }
    } catch (error) {
      console.error('[MCP Service] Error checking server availability:', error)
      this.isServerAvailable = false
    }
  }

  /**
   * Search ArXiv for research papers using the MCP research server
   * This method spawns the server process, communicates via JSON-RPC, and returns results
   */
  async searchArxiv(query: string, maxResults: number = 5): Promise<ArxivSearchResult> {
    console.log(`[MCP Service] Searching ArXiv for: "${query}"`)
    
    if (!this.isServerAvailable) {
      return {
        success: false,
        error: 'MCP research server not available',
        papers: []
      }
    }

    const startTime = Date.now()
    
    try {
      // Spawn the MCP server process
      const serverProcess = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let serverOutput = ''
      let serverReady = false
      let hasReceivedResponse = false

      // Set up output handlers
      serverProcess.stdout.on('data', (data) => {
        serverOutput += data.toString()
      })

      serverProcess.stderr.on('data', (data) => {
        const log = data.toString()
        console.log('[MCP Service]', log.trim())
        
        // Check if server is ready
        if (log.includes('Enhanced server started successfully')) {
          serverReady = true
        }
      })

      // Wait for server to be ready with timeout
      await this.waitForCondition(() => serverReady, 10000, 'Server startup timeout')
      
      console.log('[MCP Service] Server ready, initializing connection...')

      // Step 1: Initialize the MCP connection
      const initMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-client", version: "1.0.0" }
        }
      }

      serverProcess.stdin.write(JSON.stringify(initMessage) + '\n')
      await this.sleep(1000) // Give server time to process

      // Step 2: Execute ArXiv search
      const searchMessage = {
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
      }

      console.log('[MCP Service] Sending search request:', searchMessage.params)
      serverProcess.stdin.write(JSON.stringify(searchMessage) + '\n')

      // Wait for response with timeout
      await this.waitForCondition(() => {
        hasReceivedResponse = serverOutput.includes('"id":2')
        return hasReceivedResponse
      }, 15000, 'Search request timeout')

      // Clean up process
      serverProcess.kill()

      // Parse and return results
      return this.parseServerResponse(serverOutput, startTime)

    } catch (error) {
      console.error('[MCP Service] Error during ArXiv search:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        papers: [],
        execution_time: Date.now() - startTime
      }
    }
  }

  /**
   * Parse the server response and extract ArXiv results
   */
  private parseServerResponse(serverOutput: string, startTime: number): ArxivSearchResult {
    const executionTime = Date.now() - startTime
    
    try {
      // Split output by lines and find JSON responses
      const lines = serverOutput.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line)
          
          // Look for our search response (id: 2)
          if (response.id === 2 && response.result?.content?.[0]?.text) {
            const resultText = response.result.content[0].text
            const searchResult = JSON.parse(resultText)
            
            if (searchResult.success && searchResult.papers) {
              console.log(`[MCP Service] Successfully found ${searchResult.papers.length} papers`)
              
              return {
                success: true,
                papers: searchResult.papers,
                total_results: searchResult.papers.length,
                execution_time: executionTime
              }
            } else {
              return {
                success: false,
                error: searchResult.error || 'Search returned no results',
                papers: [],
                execution_time: executionTime
              }
            }
          }
        } catch (parseError) {
          // Skip non-JSON lines
          continue
        }
      }

      // If we get here, no valid response was found
      return {
        success: false,
        error: 'No valid search results found in server response',
        papers: [],
        execution_time: executionTime
      }

    } catch (error) {
      console.error('[MCP Service] Error parsing server response:', error)
      return {
        success: false,
        error: 'Failed to parse server response',
        papers: [],
        execution_time: executionTime
      }
    }
  }

  /**
   * Utility function to wait for a condition with timeout
   */
  private async waitForCondition(
    condition: () => boolean, 
    timeoutMs: number, 
    errorMessage: string
  ): Promise<void> {
    const startTime = Date.now()
    
    while (!condition()) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(errorMessage)
      }
      await this.sleep(100) // Check every 100ms
    }
  }

  /**
   * Simple sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get service status for monitoring
   */
  getStatus(): any {
    return {
      isServerAvailable: this.isServerAvailable,
      serverPath: this.serverPath,
      lastCheck: new Date().toISOString()
    }
  }

  /**
   * Clean up resources (placeholder for future use)
   */
  async close(): Promise<void> {
    console.log('[MCP Service] Service closed')
  }
}

// Export a singleton instance for consistency
let mcpServiceInstance: MCPService | null = null

export function getMcpService(): MCPService {
  if (!mcpServiceInstance) {
    mcpServiceInstance = new MCPService()
  }
  return mcpServiceInstance
}