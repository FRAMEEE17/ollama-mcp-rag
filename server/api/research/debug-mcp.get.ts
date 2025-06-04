// server/api/research/debug-mcp.get.ts

import { defineEventHandler } from 'h3'
import { McpService } from '@/server/utils/mcp'

export default defineEventHandler(async (event) => {
  try {
    console.log('[MCP Debug] Starting MCP service test...')
    
    const mcpService = new McpService()
    
    try {
      const tools = await mcpService.listTools()
      console.log('[MCP Debug] Tools found:', tools.map(t => t.name))
      
      const arxivTool = tools.find(t => t.name === 'arxiv_query')
      console.log('[MCP Debug] ArXiv tool found:', !!arxivTool)
      
      if (arxivTool) {
        console.log('[MCP Debug] ArXiv tool details:', {
          name: arxivTool.name,
          description: arxivTool.description
        })
      }
      
      const status = mcpService.getStatus()
      console.log('[MCP Debug] MCP Status:', status)
      
      return {
        success: true,
        tools_count: tools.length,
        tool_names: tools.map(t => t.name),
        arxiv_available: !!arxivTool,
        mcp_status: status
      }
      
    } finally {
      await mcpService.close()
    }
    
  } catch (error) {
    console.error('[MCP Debug] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }
  }
})