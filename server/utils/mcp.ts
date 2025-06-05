import { spawn } from 'child_process'
import fs from 'fs'

export class MCPService {
  
  async searchArxiv(query: string, maxResults: number = 5): Promise<any> {
    console.log(`[Direct MCP] Searching ArXiv for: "${query}"`)
    
    if (!fs.existsSync('./mcp/servers/research-server.cjs')) {
      throw new Error('Research server not found')
    }

    try {
      const serverProcess = spawn('node', ['./mcp/servers/research-server.cjs'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let serverOutput = ''
      let serverReady = false

      serverProcess.stdout.on('data', (data) => {
        serverOutput += data.toString()
      })

      serverProcess.stderr.on('data', (data) => {
        const log = data.toString()
        console.log('[Direct MCP]', log.trim())
        if (log.includes('Enhanced server started successfully')) {
          serverReady = true
        }
      })

      // Wait for server startup
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          serverProcess.kill()
          reject(new Error('Server timeout'))
        }, 10000)

        const checkReady = () => {
          if (serverReady) {
            clearTimeout(timeout)
            resolve(void 0)
          } else {
            setTimeout(checkReady, 100)
          }
        }
        checkReady()
      })

      console.log('[Direct MCP] Server ready, sending requests...')

      // Initialize MCP
      const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "direct-client", version: "1.0.0" }
        }
      }
      serverProcess.stdin.write(JSON.stringify(initRequest) + '\n')
      await this.sleep(1000)

      // Search ArXiv
      const searchRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "arxiv_query",
          arguments: {
            keywords: [query],
            max_results: maxResults
          }
        }
      }
      serverProcess.stdin.write(JSON.stringify(searchRequest) + '\n')
      await this.sleep(6000)

      serverProcess.kill()

      // Parse results
      const responses = serverOutput.split('\n').filter(line => line.trim())
      
      for (const responseLine of responses) {
        try {
          const response = JSON.parse(responseLine)
          if (response.id === 2 && response.result?.content?.[0]?.text) {
            const result = JSON.parse(response.result.content[0].text)
            console.log(`[Direct MCP] ✅ Found ${result.papers?.length || 0} papers`)
            return result
          }
        } catch (e) {
          continue
        }
      }

      return { success: false, error: 'No results found', papers: [] }

    } catch (error) {
      console.error('[Direct MCP] Error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage, papers: [] }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Legacy compatibility for existing code
export class McpService {
  private directMcp = new MCPService()

  async listTools() {
    return [{
      name: 'arxiv_query',
      description: 'Search ArXiv papers',
      invoke: async (params: any) => {
        const query = params.keywords?.[0] || params.query || 'machine learning'
        return await this.directMcp.searchArxiv(query, params.max_results || 5)
      }
    }]
  }

  getStatus() {
    return {
      isInitialized: true,
      hasActiveClient: true,
      hasCachedTools: false,
      cachedToolCount: 1,
      cacheAge: 0,
      isCacheValid: true
    }
  }

  async close() {
    console.log('[Direct MCP] Closed')
  }

  clearCache() {
    console.log('[Direct MCP] Cache cleared')
  }

  async refreshTools() {
    return await this.listTools()
  }
}

// Export for compatibility with existing code
let mcpServiceInstance: McpService | null = null

export function getMcpService(): McpService {
  if (!mcpServiceInstance) {
    mcpServiceInstance = new McpService()
  }
  return mcpServiceInstance
}