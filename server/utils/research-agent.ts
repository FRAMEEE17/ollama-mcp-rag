import { McpService } from '@/server/utils/mcp'
import { BaseChatModel } from '@langchain/core/language_models/chat_models' 
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

interface ResearchQuery {
  query: string
  max_results?: number
}

interface ResearchParams {
  keywords: string[]
  categories: string[]
  recent_only: boolean
  days_back: number
}

interface ResearchResult {
  success: boolean
  papers: any[]
  summary: string
  search_params: ResearchParams
  total_results: number
  execution_time: number
  debug_info?: any
  error?: string
}

export class ResearchAgent {
  private mcpService: McpService
  private llm: BaseChatModel

  constructor(llm: BaseChatModel) {
    this.llm = llm
    this.mcpService = new McpService()
  }

  async research(request: ResearchQuery): Promise<ResearchResult> {
    const startTime = Date.now()
    
    try {
      console.log('[Research Agent] Starting research for:', request.query)

      const searchParams = await this.extractSearchParameters(request.query)
      console.log('[Research Agent] Extracted params:', searchParams)

      const arxivResult = await this.executeArxivSearch(searchParams, request.max_results)
      
      if (!arxivResult.success) {
        throw new Error(arxivResult.error || 'ArXiv search failed')
      }

      const summary = await this.generateSummary(arxivResult.papers, request.query)

      return {
        success: true,
        papers: arxivResult.papers || [],
        summary,
        search_params: searchParams,
        total_results: arxivResult.total_results || 0,
        execution_time: Date.now() - startTime,
        debug_info: arxivResult.debug_info
      }

    } catch (error) {
      console.error('[Research Agent] Error:', error)
      return {
        success: false,
        papers: [],
        summary: '',
        search_params: {
          keywords: [],
          categories: [],
          recent_only: false,
          days_back: 30
        },
        total_results: 0,
        execution_time: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Research failed'
      }
    }
  }

  private async extractSearchParameters(query: string): Promise<ResearchParams> {
    const extractionPrompt = `
Analyze this research query and extract ArXiv search parameters:
"${query}"

Extract:
- keywords: 2-4 most relevant terms as array
- categories: relevant arxiv categories (cs.AI, cs.LG, cs.CL, cs.RO, etc.)
- recent_only: true if asking for recent/latest/new papers
- days_back: number of days if recent_only

Return only valid JSON:
{
  "keywords": ["term1", "term2"],
  "categories": ["cs.AI", "cs.LG"],
  "recent_only": false,
  "days_back": 30
}`

    try {
      const extraction = await this.llm.invoke([
        new SystemMessage("You are a research parameter extractor. Return only valid JSON, no explanations."),
        new HumanMessage(extractionPrompt)
      ])

      const content = extraction.content as string
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[0] : content
      return JSON.parse(jsonStr)
    } catch (parseError) {
      console.warn('[Research Agent] JSON parse failed, using fallback')
      return {
        keywords: this.extractBasicKeywords(query),
        categories: ["cs.AI", "cs.LG"],
        recent_only: query.toLowerCase().includes('recent') || query.toLowerCase().includes('latest'),
        days_back: 30
      }
    }
  }

  private async executeArxivSearch(params: ResearchParams, maxResults?: number): Promise<any> {
    try {
      const tools = await this.mcpService.listTools()
      const arxivTool = tools.find(t => t.name === 'arxiv_query')
      
      if (!arxivTool) {
        throw new Error('ArXiv tool not available in MCP server')
      }

      const arxivParams = {
        ...params,
        max_results: maxResults || 10
      }

      console.log('[Research Agent] Executing ArXiv search via MCP:', arxivParams)
      const mcpResult = await arxivTool.invoke(arxivParams)
      
      return typeof mcpResult === 'string' ? JSON.parse(mcpResult) : mcpResult
    } catch (error) {
      console.error('[Research Agent] ArXiv search failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Search failed' }
    }
  }

  private async generateSummary(papers: any[], originalQuery: string): Promise<string> {
    if (!papers || papers.length === 0) {
      return "No relevant papers found for your research query."
    }

    const summaryPrompt = `
Analyze these ${papers.length} research papers and provide:

1. Brief summary of the research landscape
2. Key findings and trends
3. Notable papers and contributions

Original Query: "${originalQuery}"

Papers:
${papers.slice(0, 5).map((p: any, i: number) => 
  `${i+1}. "${p.title}" by ${p.authors?.map((a: any) => a.name).join(', ') || 'Unknown'}`
).join('\n')}

Keep it concise and research-focused.`

    try {
      const summaryResponse = await this.llm.invoke([
        new SystemMessage("You are a research analyst. Provide concise, insightful analysis."),
        new HumanMessage(summaryPrompt)
      ])

      return summaryResponse.content as string
    } catch (error) {
      console.error('[Research Agent] Summary generation failed:', error)
      return `Found ${papers.length} relevant papers on your research topic.`
    }
  }

  private extractBasicKeywords(query: string): string[] {
    const STOP_WORDS = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'recent', 'advances', 'using']
    return query.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.includes(word))
      .slice(0, 4)
  }

  async close(): Promise<void> {
    await this.mcpService.close()
  }
}