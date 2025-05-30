import { defineEventHandler, readBody } from 'h3'
import { createChatModel } from '@/server/utils/models'
import { McpService } from '@/server/utils/mcp'

interface RequestBody {
  query: string
  max_results?: number
  model?: string
  family?: string
}

interface ArxivParams {
  query: string
  max_results: number
  sort_by?: string
  sort_order?: string
}

export default defineEventHandler(async (event) => {
  let family = 'nvidia'; // Default value
  try {
    console.log('[Research Agent] Starting...')
    
    // 🚀 MODEL SELECTION - Choose your provider:
    const { 
      query, 
      max_results = 10, 
      
      // 🌟 NVIDIA API MODELS (Recommended - No GPU needed!)
      model = 'meta/llama-3.1-8b-instruct',  // Fast and capable
      // model = 'meta/llama-3.1-70b-instruct', // More powerful
      // model = 'nvidia/llama-3.1-nemotron-70b-instruct', // NVIDIA's optimized
      // model = 'mistralai/mixtral-8x7b-instruct-v0.1', // Alternative
      family = 'nvidia'  // Use NVIDIA API
      
      // 🖥️ VLLM LOCAL MODELS (Requires local VLLM server + GPU)
      // model = 'microsoft/DialoGPT-medium',     // Small test model
      // model = 'Qwen/Qwen2.5-7B-Instruct',     // Good for research
      // model = 'meta-llama/Llama-3.1-8B-Instruct', // Powerful option
      // model = 'mistralai/Mixtral-8x7B-Instruct-v0.1', // MoE model
      // family = 'vllm'  // Use local VLLM server
      
    }: RequestBody = await readBody(event)
    
    if (!query) {
      throw new Error('Research query is required')
    }

    console.log(`[Research Agent] Using ${family.toUpperCase()} ${family === 'nvidia' ? 'API' : 'Server'} with ${model}`)
    console.log(`[Research Agent] Query: "${query}"`)
    const startTime = Date.now()

    // Create LLM instance (supports both NVIDIA API and VLLM local server)
    const llm = createChatModel(model, family, event)
    
    // Extract search parameters using LLM (works with both NVIDIA API & VLLM)
    const extractionPrompt = `
You are a research assistant. Extract optimal ArXiv search parameters from this query.

Query: "${query}"

Return ONLY valid JSON with these fields:
- query: optimized search terms for ArXiv (use AND, OR, quotes for phrases)
- max_results: number between 5-20
- sort_by: "relevance" or "lastUpdatedDate"
- categories: relevant arXiv categories (cs.AI, cs.LG, cs.CV, etc.)

Example: {"query": "machine learning AND computer vision", "max_results": 10, "sort_by": "relevance", "categories": ["cs.AI", "cs.CV"]}

JSON:
`

    console.log(`[Research Agent] 🧠 Extracting parameters with ${family.toUpperCase()}...`)
    const extractionResponse = await llm.invoke([['human', extractionPrompt]])
    console.log('[Research Agent] LLM Response:', extractionResponse.content)
    
    // Parse LLM response (works for both NVIDIA API & VLLM)
    let searchParams: ArxivParams
    try {
      const content = extractionResponse.content as string
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*?\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        searchParams = {
          query: parsed.query || query,
          max_results: Math.min(Math.max(parsed.max_results || max_results, 5), 20),
          sort_by: parsed.sort_by || 'relevance',
          sort_order: 'descending'
        }
        console.log('[Research Agent] ✅ Parsed search params:', searchParams)
      } else {
        throw new Error(`No JSON found in ${family.toUpperCase()} response`)
      }
    } catch (parseError) {
      console.log('[Research Agent] ⚠️ JSON parse failed, using fallback params')
      searchParams = {
        query: query,
        max_results: Math.min(max_results, 15),
        sort_by: 'relevance', 
        sort_order: 'descending'
      }
    }

    // Execute ArXiv search via MCP
    const mcpService = new McpService()
    try {
      const tools = await mcpService.listTools()
      const arxivTool = tools.find(t => t.name === 'arxiv_query')
      
      if (!arxivTool) {
        throw new Error('ArXiv MCP tool not available. Please ensure MCP server is running.')
      }

      console.log('[Research Agent] 🔍 Executing ArXiv search via MCP...')
      const searchResult = await arxivTool.invoke(searchParams)
      console.log('[Research Agent] ✅ Search completed, found papers')

      // Prompt (not finished)
      const summaryPrompt = `
You are an expert research analyst. Analyze these ArXiv papers and create a comprehensive research summary.

RESEARCH PAPERS DATA:
${searchResult.content}

Create a well-structured analysis with these sections:

## 🎯 Research Overview
- Brief field summary and current state
- Key themes and focus areas
- Timeline of recent developments

## 📊 Key Papers Analysis
For the 3-5 most important papers:
**[Paper Title]** by [Authors]
- 🔬 **Core Contribution**: What's new/innovative
- 🛠️ **Methodology**: Approach used  
- 📈 **Results**: Key findings/performance
- 🎯 **Relevance**: Why this matters

## 🔍 Research Trends & Patterns
- **Emerging Methods**: New techniques being adopted
- **Popular Approaches**: What's working well
- **Research Gaps**: What's missing/needed
- **Future Directions**: Where the field is heading

## 💡 Practical Applications
- Real-world use cases and commercial potential
- Industry adoption possibilities
- Implementation considerations

## 🚀 Actionable Recommendations
- **Must-read papers** (priority order)
- **Research opportunities** for new work
- **Related areas** to explore
- **Tools/datasets** mentioned

Keep the analysis concise but insightful for both researchers and practitioners.
`

      console.log(`[Research Agent] 🧠 Generating comprehensive summary with ${family.toUpperCase()}...`)
      const summaryResponse = await llm.invoke([['human', summaryPrompt]])
      
      const executionTime = Date.now() - startTime
      console.log(`[Research Agent] ✅ Research completed in ${executionTime}ms using ${family.toUpperCase()} ${model}`)

      return {
        success: true,
        query: searchParams.query,
        model_used: `${family}/${model}`,
        papers: searchResult.content,
        summary: summaryResponse.content,
        execution_time: executionTime,
        search_params: searchParams,
        papers_found: searchParams.max_results,
        provider: family === 'nvidia' ? 'NVIDIA API (Cloud)' : 'VLLM (Local Server)',
        cost_estimate: family === 'nvidia' ? 'Pay-per-token pricing' : 'Local compute only'
      }

    } finally {
      // Always cleanup MCP service
      await mcpService.close()
    }

  } catch (error) {
    console.error('[Research Agent] ❌ Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Research agent failed',
      papers: [],
      summary: `Research analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      execution_time: 0,
      details: error instanceof Error ? error.stack : 'Unknown error',
      provider: family === 'nvidia' ? 'NVIDIA API' : 'VLLM Local',
      troubleshooting: {
        nvidia_issues: family === 'nvidia' ? 'Ensure NVIDIA API key is set in settings' : 'N/A',
        vllm_issues: family === 'vllm' ? 'Check VLLM server is running and accessible' : 'N/A', 
        mcp_check: 'Verify MCP ArXiv server is running',
        model_check: 'Confirm model is available on selected provider'
      }
    }
  }
})