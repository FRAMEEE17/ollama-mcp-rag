import { defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const { query } = await readBody(event)
    
    // Direct ArXiv API call with debug info
    const searchQuery = query.replace(/\s+/g, '+')
    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=5`
    
    console.log('🔍 Debug ArXiv URL:', url)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Enterprise-Research-Assistant/1.0',
        'Accept': 'application/atom+xml'
      }
    })
    
    const xmlText = await response.text()
    
    // Debug: Show first 500 characters of XML
    console.log('📄 Raw XML (first 500 chars):', xmlText.substring(0, 500))
    
    // Count entries in XML
    const entryMatches = xmlText.match(/<entry>/g)
    const entryCount = entryMatches ? entryMatches.length : 0
    
    console.log('📊 Found entries in XML:', entryCount)
    
    // Try to extract one title manually
    const titleMatch = xmlText.match(/<title[^>]*>([^<]+)<\/title>/)
    const firstTitle = titleMatch ? titleMatch[1] : 'No title found'
    
    return {
      success: true,
      debug: {
        url,
        response_status: response.status,
        xml_length: xmlText.length,
        xml_preview: xmlText.substring(0, 500),
        entry_count: entryCount,
        first_title: firstTitle,
        has_entry_tags: xmlText.includes('<entry>'),
        has_arxiv_entries: xmlText.includes('arxiv.org/abs/')
      }
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})