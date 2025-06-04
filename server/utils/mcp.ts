// server/utils/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { type StructuredToolInterface } from "@langchain/core/tools"
import { loadMcpTools, MultiServerMCPClient } from '@langchain/mcp-adapters'
import fs from 'fs'
import path from 'path'

interface McpServerConfig {
  command: string
  args: string[]
  transport?: string
  env?: Record<string, string>
}

interface McpConfig {
  servers: Record<string, McpServerConfig>  // Fixed: changed from mcpServers to servers
}

interface ToolCache {
  tools: StructuredToolInterface[]
  timestamp: number
}

export class McpService {
  private mcpClient: MultiServerMCPClient | null = null
  private toolsCache: ToolCache | null = null
  private readonly cacheDuration: number = 5 * 60 * 1000 // 5 minutes
  private isInitialized: boolean = false
  private initializationPromise: Promise<StructuredToolInterface[]> | null = null

  async listTools(): Promise<StructuredToolInterface[]> {
    // Check cache validity before loading tools from servers
    if (this.toolsCache && this.isCacheValid()) {
      console.log("Returning cached MCP tools:", this.toolsCache.tools.length)
      return this.toolsCache.tools
    }

    // Prevent concurrent initialization by returning existing promise if already initializing
    if (this.initializationPromise) {
      console.log("MCP initialization already in progress, waiting...")
      return await this.initializationPromise
    }

    // Create initialization promise to handle concurrent requests
    this.initializationPromise = this.initializeTools()
    
    try {
      const tools = await this.initializationPromise
      // Cache the loaded tools with timestamp for future requests
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

  private async initializeTools(): Promise<StructuredToolInterface[]> {
    const mcpConfigPath = this.getMcpConfigPath()
    
    if (!fs.existsSync(mcpConfigPath)) {
      console.warn("MCP config file not found:", mcpConfigPath)
      return []
    }

    try {
      console.log("Loading MCP servers from", mcpConfigPath)
      
      // Close existing client before creating new one to prevent resource leaks
      if (this.mcpClient) {
        await this.mcpClient.close()
      }

      // Check if config format is correct
      const configContent = fs.readFileSync(mcpConfigPath, 'utf8')
      const config = JSON.parse(configContent)
      
      // Validate config structure
      if (!config.servers && config.mcpServers) {
        console.log("Converting legacy mcpServers format to servers format...")
        // Convert legacy format on the fly
        const convertedConfig: McpConfig = {
          servers: {} as Record<string, McpServerConfig>
        }
        
        for (const [name, serverConfig] of Object.entries(config.mcpServers as Record<string, any>)) {
          convertedConfig.servers[name] = {
            ...serverConfig,
            transport: serverConfig.transport || 'stdio' // Default to stdio if not specified
          }
        }
        
        // Save the converted config
        fs.writeFileSync(mcpConfigPath, JSON.stringify(convertedConfig, null, 2))
        console.log("✅ Config file converted to new format")
      } else if (!config.servers) {
        console.error("Invalid MCP config: missing 'servers' property")
        return []
      }
      
      this.mcpClient = MultiServerMCPClient.fromConfigFile(mcpConfigPath)
      await this.mcpClient.initializeConnections()
      
      const tools = await this.mcpClient.getTools()
      console.log("MCP tools loaded successfully:", tools.map(t => t.name))
      
      this.isInitialized = true
      return tools
    } catch (error) {
      console.error("Failed to parse MCP config file:", error)
      // Return empty array instead of throwing to prevent chat interruption
      return []
    }
  }

  private getMcpConfigPath(): string {
    return process.env.MCP_SERVERS_CONFIG_PATH || path.join(process.cwd(), '.mcp-servers.json')
  }

  private isCacheValid(): boolean {
    if (!this.toolsCache) return false
    return Date.now() - this.toolsCache.timestamp < this.cacheDuration
  }

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

  clearCache() {
    this.toolsCache = null
    console.log("MCP tools cache cleared")
  }

  async refreshTools(): Promise<StructuredToolInterface[]> {
    this.clearCache()
    return await this.listTools()
  }

  async getServerConfigs(): Promise<Record<string, McpServerConfig>> {
    const configPath = this.getMcpConfigPath()
    
    if (!fs.existsSync(configPath)) {
      return {}
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8')
      const config: McpConfig = JSON.parse(configContent)
      return config.servers || {}
    } catch (error) {
      console.error("Failed to read MCP server configs:", error)
      return {}
    }
  }
}