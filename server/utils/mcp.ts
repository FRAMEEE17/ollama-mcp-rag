import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { type StructuredToolInterface } from "@langchain/core/tools"
import { loadMcpTools, MultiServerMCPClient } from '@langchain/mcp-adapters'
import fs from 'fs'
import path from 'path'

interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

// TODO: Implement caching mechanism to avoid repeated MCP server initialization
interface ToolCache {
  tools: StructuredToolInterface[]
  timestamp: number
}

export class McpService {
  private mcpClient: MultiServerMCPClient | null = null
  private toolsCache: ToolCache | null = null
  private readonly cacheDuration: number = 5 * 60 * 1000 // 5 minutes
  private isInitialized: boolean = false
  // TODO: Add initialization lock to prevent concurrent initialization attempts
  private initializationPromise: Promise<StructuredToolInterface[]> | null = null

  async listTools(): Promise<StructuredToolInterface[]> {
    // TODO: Check cache validity before loading tools from servers
    if (this.toolsCache && this.isCacheValid()) {
      console.log("Returning cached MCP tools:", this.toolsCache.tools.length)
      return this.toolsCache.tools
    }

    // TODO: Prevent concurrent initialization by returning existing promise if already initializing
    if (this.initializationPromise) {
      console.log("MCP initialization already in progress, waiting...")
      return await this.initializationPromise
    }

    // TODO: Create initialization promise to handle concurrent requests
    this.initializationPromise = this.initializeTools()
    
    try {
      const tools = await this.initializationPromise
      // TODO: Cache the loaded tools with timestamp for future requests
      this.toolsCache = {
        tools,
        timestamp: Date.now()
      }
      return tools
    } catch (error) {
      console.error("Failed to initialize MCP tools:", error)
      return []
    } finally {
      this.initializationPromise = null
    }
  }

  // TODO: Separate initialization logic for better error handling and testing
  private async initializeTools(): Promise<StructuredToolInterface[]> {
    const mcpConfigPath = this.getMcpConfigPath()
    
    if (!fs.existsSync(mcpConfigPath)) {
      console.warn("MCP config file not found:", mcpConfigPath)
      return []
    }

    try {
      console.log("Loading MCP servers from", mcpConfigPath)
      
      // TODO: Close existing client before creating new one to prevent resource leaks
      if (this.mcpClient) {
        await this.mcpClient.close()
      }
      
      this.mcpClient = MultiServerMCPClient.fromConfigFile(mcpConfigPath)
      await this.mcpClient.initializeConnections()
      
      const tools = await this.mcpClient.getTools()
      console.log("MCP tools loaded successfully:", tools.map(t => t.name))
      
      this.isInitialized = true
      return tools
    } catch (error) {
      console.error("Failed to parse MCP config file:", error)
      // TODO: Return empty array instead of throwing to prevent chat interruption
      return []
    }
  }

  // TODO: Extract config path resolution for better testability
  private getMcpConfigPath(): string {
    return process.env.MCP_SERVERS_CONFIG_PATH || path.join(process.cwd(), '.mcp-servers.json')
  }

  // TODO: Add cache validation method to check if cached tools are still valid
  private isCacheValid(): boolean {
    if (!this.toolsCache) return false
    return Date.now() - this.toolsCache.timestamp < this.cacheDuration
  }

  // TODO: Implement graceful shutdown with timeout to prevent hanging
  async close() {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close()
        console.log("MCP client closed successfully")
      } catch (error) {
        console.error("Error closing MCP client:", error)
      } finally {
        this.mcpClient = null
        this.isInitialized = false
      }
    }
  }

  // TODO: Add health check method for monitoring and debugging
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasActiveClient: this.mcpClient !== null,
      hasCachedTools: this.toolsCache !== null,
      cachedToolCount: this.toolsCache?.tools.length || 0,
      cacheAge: this.toolsCache ? Date.now() - this.toolsCache.timestamp : 0,
      isCacheValid: this.isCacheValid()
    }
  }

  // TODO: Add cache management methods for debugging and performance tuning
  clearCache() {
    this.toolsCache = null
    console.log("MCP tools cache cleared")
  }

  // TODO: Add method to refresh tools without full reinitialization
  async refreshTools(): Promise<StructuredToolInterface[]> {
    this.clearCache()
    return await this.listTools()
  }

  // TODO: Legacy method - consider removing if not used elsewhere
  private async getToolsFromTransport(serverName: string, transport: StdioClientTransport): Promise<StructuredToolInterface[]> {
    const client = new Client({
      name: "chatollama-client",
      version: "1.0.0",
    }, {
      capabilities: {}
    })

    await client.connect(transport)
    return await loadMcpTools(serverName, client)
  }

  // TODO: Add method to get available server configurations for debugging
  async getServerConfigs(): Promise<Record<string, McpServerConfig>> {
    const configPath = this.getMcpConfigPath()
    
    if (!fs.existsSync(configPath)) {
      return {}
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8')
      const config: McpConfig = JSON.parse(configContent)
      return config.mcpServers || {}
    } catch (error) {
      console.error("Failed to read MCP server configs:", error)
      return {}
    }
  }
}

// Key Improvements:

// Caching System - Avoids repeated server initialization
// Concurrency Control - Prevents multiple simultaneous initializations
// Error Handling - Graceful failures that don't break chat functionality
// Resource Management - Proper cleanup of connections
// Monitoring Methods - Status checks and debugging capabilities