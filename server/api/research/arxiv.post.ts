import { defineEventHandler, readBody, getMethod } from 'h3'
import { z } from 'zod'

// Search schema matching MCP server capabilities
const SearchSchema = z.object({
  keywords: z.array(z.string()).min(1), // ["RL", "knowledge graph", "LLM", "agents"]
  recent_only: z.boolean().optional().default(false), // true = recent papers only
  max_results: z.number().min(1).max(50).optional().default(10),
  categories: z.array(z.string()).optional(), // ["cs.AI", "cs.LG", "cs.CL"]
  days_back: z.number().min(1).max(365).optional().default(365), // Only when recent_only = true
  sort_by: z.enum(['relevance', 'date']).optional().default('relevance')
})

class ArxivTool {
  private readonly baseUrl = 'http://export.arxiv.org/api/query'
  private readonly userAgent = 'Enterprise-Research-Assistant/1.0'

  async search(args: any): Promise<any> {
    const startTime = Date.now()

    try {
      const params = SearchSchema.parse(args)

      console.log('[ ArXiv] Search params:', JSON.stringify(params, null, 2))

      // Build advanced query with multiple keywords (OR logic)
      const keywordQuery = params.keywords.map(k => `"${k}"`).join(' OR ')
      console.log('📝 [ ArXiv] Keyword query:', keywordQuery)

      let searchQuery = `(${keywordQuery})`

      // Add category filter if specified
      if (params.categories && params.categories.length > 0) {
        const categoryFilter = params.categories.map(cat => `cat:${cat}`).join(' OR ')
        searchQuery = `(${searchQuery}) AND (${categoryFilter})`
        console.log('🏷️ [ ArXiv] Added categories:', categoryFilter)
      }

      // Add date range filter if recent_only is true
      if (params.recent_only) {
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(endDate.getDate() - params.days_back)

        const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '')
        const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '')

        searchQuery = `submittedDate:[${startDateStr} TO ${endDateStr}] AND (${searchQuery})`
        console.log('📅 [ ArXiv] Added date filter:', `${startDateStr} TO ${endDateStr}`)
      }

      // Build URL with parameters
      const url = new URL(this.baseUrl)
      url.searchParams.set('search_query', searchQuery)
      url.searchParams.set('start', '0')
      url.searchParams.set('max_results', (params.max_results * 2).toString()) // Get more to filter

      // Set sort order
      if (params.sort_by === 'date') {
        url.searchParams.set('sortBy', 'submittedDate')
        url.searchParams.set('sortOrder', 'descending')
      } else {
        url.searchParams.set('sortBy', 'relevance')
        url.searchParams.set('sortOrder', 'descending')
      }

      console.log('🌐 [ ArXiv] Final URL:', url.toString())

      // Execute search
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/atom+xml'
        }
      })

      if (!response.ok) {
        throw new Error(`ArXiv API failed: ${response.status} ${response.statusText}`)
      }

      const xmlText = await response.text()
      console.log('[ ArXiv] XML response length:', xmlText.length)

      const allPapers = await this.parseArxivResponse(xmlText)
      console.log('[ ArXiv] Parsed papers:', allPapers.length)

      // Apply filtering and scoring
      const scoredPapers = this.enhanceAndScore(allPapers, params.keywords)
      const finalPapers = scoredPapers.slice(0, params.max_results)

      const result = {
        papers: finalPapers,
        total_results: finalPapers.length,
        search_params: {
          keywords: params.keywords,
          recent_only: params.recent_only,
          categories: params.categories,
          sort_by: params.sort_by,
          ...(params.recent_only && {
            date_range: {
              days_back: params.days_back,
              start: new Date(Date.now() - params.days_back * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              end: new Date().toISOString().split('T')[0]
            }
          })
        },
        execution_time: Date.now() - startTime,
        debug_info: {
          original_results: allPapers.length,
          final_query: searchQuery,
          xml_length: xmlText.length
        }
      }

      console.log('[ ArXiv] Search completed:', {
        keywords: params.keywords,
        total_found: finalPapers.length,
        execution_time: result.execution_time
      })

      return result

    } catch (error) {
      console.error('❌ [ ArXiv] Search failed:', error)
      throw error
    }
  }

  private enhanceAndScore(papers: any[], keywords: string[]): any[] {
    return papers.map(paper => {
      // Calculate relevance score based on keyword matches
      let score = 0
      const text = (paper.title + ' ' + paper.summary).toLowerCase()

      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase()
        const titleMatches = (paper.title.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length
        const summaryMatches = (paper.summary.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length

        score += titleMatches * 3 + summaryMatches * 1 // Title matches weighted higher
      })

      return {
        ...paper,
        relevance_score: score,
        keyword_matches: keywords.filter(k =>
          text.includes(k.toLowerCase())
        )
      }
    }).sort((a, b) => b.relevance_score - a.relevance_score) // Sort by relevance
  }

  private async parseArxivResponse(xmlText: string): Promise<any[]> {
    try {
      const papers: any[] = []
      const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || []

      console.log('[ ArXiv] Found entries in XML:', entryMatches.length)

      for (const entryXml of entryMatches) {
        try {
          const paper = this.parseEntry(entryXml)
          if (paper) {
            papers.push(paper)
          }
        } catch (error) {
          console.error('❌ [ ArXiv] Failed to parse entry:', error)
        }
      }

      return papers
    } catch (error) {
      throw new Error('Failed to parse ArXiv XML response')
    }
  }

  private parseEntry(entryXml: string): any | null {
    try {
      const id = this.extractXmlField(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || ''
      const title = this.extractXmlField(entryXml, 'title')?.replace(/\s+/g, ' ').trim() || ''
      const summary = this.extractXmlField(entryXml, 'summary')?.replace(/\s+/g, ' ').trim() || ''
      const published = this.extractXmlField(entryXml, 'published') || ''
      const updated = this.extractXmlField(entryXml, 'updated') || ''

      // Author parsing with multiple approaches
      let authors: any[] = []

      // Approach 1: <name>Name</name> tags
      const nameMatches1 = entryXml.match(/<name>([^<]+)<\/name>/g) || []
      if (nameMatches1.length > 0) {
        authors = nameMatches1.map(match => ({
          name: match.replace(/<name>|<\/name>/g, '').trim()
        }))
      }

      // Approach 2: <name ...>Name</name> tags (with attributes)
      if (authors.length === 0) {
        const nameMatches2 = entryXml.match(/<name[^>]*>([^<]+)<\/name>/g) || []
        authors = nameMatches2.map(match => ({
          name: match.replace(/<name[^>]*>|<\/name>/g, '').trim()
        }))
      }

      // Debug empty authors
      if (authors.length === 0) {
        console.log('⚠️ [ ArXiv] No authors found for:', id)
        console.log('[ ArXiv] Author section:', entryXml.match(/<author>[\s\S]*?<\/author>/g))
      }

      // Extract categories
      const categoryMatches = entryXml.match(/<category[^>]+term="([^"]+)"/g) || []
      const categories = categoryMatches.map(match => {
        const termMatch = match.match(/term="([^"]+)"/)
        return termMatch ? termMatch[1] : ''
      }).filter(cat => cat)

      if (!id || !title) {
        console.log('⚠️ [ ArXiv] Missing required fields:', { id: !!id, title: !!title })
        return null
      }

      const paper = {
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

      console.log('✅ [ ArXiv] Successfully parsed:', {
        id,
        title: title.substring(0, 60) + '...',
        authors: authors.length,
        categories: categories.length
      })

      return paper

    } catch (error) {
      console.log('❌ [ ArXiv] Parse entry error:', error)
      return null
    }
  }

  private extractXmlField(xml: string, fieldName: string): string | null {
    const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i')
    const match = xml.match(regex)
    return match ? match[1].trim() : null
  }
}

const arxivTool = new ArxivTool()

export default defineEventHandler(async (event) => {
  try {
    // Only handle POST requests
    const method = getMethod(event)
    if (method !== 'POST') {
      throw new Error(`Method ${method} not allowed. Use POST.`)
    }

    // Read and validate request body
    let requestBody
    try {
      requestBody = await readBody(event)
      console.log('[ ArXiv] Received request body:', requestBody)
    } catch (error) {
      console.error('[ ArXiv] Failed to read request body:', error)
      throw new Error('Invalid request body. Expected JSON.')
    }

    // Handle empty or null body
    if (!requestBody) {
      throw new Error('Request body is required')
    }

    // Execute search
    const result = await arxivTool.search(requestBody)

    return {
      success: true,
      ...result,
      api_type: '_arxiv'
    }

  } catch (error) {
    console.error('❌ [ ArXiv] API Error:', error)
    
    // Handle Zod validation errors specially
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Validation failed',
        validation_errors: error.errors,
        api_type: '_arxiv'
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      api_type: '_arxiv'
    }
  }
})