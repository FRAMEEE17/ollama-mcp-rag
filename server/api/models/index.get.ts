import { type ModelResponse, type ModelDetails } from 'ollama'
import { MODEL_FAMILIES, OPENAI_GPT_MODELS, ANTHROPIC_MODELS, AZURE_OPENAI_GPT_MODELS, MOONSHOT_MODELS, GEMINI_MODELS, GROQ_MODELS, VLLM_MODELS, NVIDIA_MODELS } from '~/config/index'
import { getOllama } from '@/server/utils/ollama'

export interface ModelItem extends Partial<Omit<ModelResponse, 'details'>> {
  details: Partial<ModelDetails> & { family: string }
}

// Add interface for the API response
interface ModelApiResponse {
  data: Array<{
    id: string
    name: string
    created?: number
    description?: string
    // ... other optional fields
  }>
}
async function fetchVLLMModels(endpoint: string, apiKey?: string) {
  try {
    // Skip if no endpoint configured
    if (!endpoint || endpoint === 'http://localhost:8694/v1') {
      console.log('VLLM: Using default endpoint, skipping model fetch (server likely not running)')
      return []
    }

    // Skip if no API key and server requires one
    if (!apiKey || apiKey.trim() === '') {
      console.log('VLLM: No API key provided, using "EMPTY" for local server')
      apiKey = 'EMPTY' // VLLM default for local servers
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    
    // Only add Authorization if we have a real API key
    if (apiKey && apiKey !== 'EMPTY') {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(`${endpoint}/models`, {
      headers,
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    return data.data || []
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn(`VLLM models fetch failed:`, message)
    // Return empty array instead of throwing - this is not critical
    return []
  }
}


export default defineEventHandler(async (event) => {
  const keys = event.context.keys
  const models: ModelItem[] = []

  const ollama = await getOllama(event)
  if (ollama) {
    const response = await ollama.list()
    models.push(...response.models)
  }

  if (keys.openai.key) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${keys.openai.key}`,
        }
      })

      if (response.ok) {
        const data = await response.json()
        const openaiModels = data.data
          .filter((model: any) => !model.id.includes('embedding'))
          .sort((a: any, b: any) => a.id.localeCompare(b.id))
          .map((model: any) => model.id)

        openaiModels.forEach((model: string) => {
          models.push({
            name: model,
            details: {
              family: MODEL_FAMILIES.openai
            }
          })
        })
      }
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error)
      // Fallback to static models if API call fails
      OPENAI_GPT_MODELS.forEach((model) => {
        models.push({
          name: model,
          details: {
            family: MODEL_FAMILIES.openai
          }
        })
      })
    }
  }

  if (keys.azureOpenai.key && keys.azureOpenai.endpoint && keys.azureOpenai.deploymentName) {
    AZURE_OPENAI_GPT_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.azureOpenai
        }
      })
    })
  }

  if (keys.anthropic.key) {
    ANTHROPIC_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.anthropic
        }
      })
    })
  }

  if (keys.moonshot.key) {
    MOONSHOT_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.moonshot
        }
      })
    })
  }

  if (keys.gemini.key) {
    GEMINI_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.gemini
        }
      })
    })
  }

  if (keys.groq.key) {
    GROQ_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.groq
        }
      })
    })
  }

  // ADD VLLM SUPPORT
if (keys.vllm.endpoint) {
  // Skip if using default endpoint and no key (server likely not running)
  if (keys.vllm.endpoint === 'http://localhost:8694/v1' && !keys.vllm.key) {
    console.log('VLLM: Using default endpoint without API key, assuming server not running - using static models')
    VLLM_MODELS.forEach((model) => {
      models.push({
        name: model,
        details: {
          family: MODEL_FAMILIES.vllm
        }
      })
    })
  } else {
    // Try to fetch from actual server
    try {
      const headers: Record<string, string> = {}
      
      // Handle API key properly
      if (keys.vllm.key && keys.vllm.key.trim() !== '') {
        headers['Authorization'] = `Bearer ${keys.vllm.key}`
      }

      console.log(`Fetching VLLM models from: ${keys.vllm.endpoint}/models`)
      
      const response = await fetch(`${keys.vllm.endpoint}/models`, {
        headers,
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        const data = await response.json()
        const vllmModels = data.data || []
        
        if (vllmModels.length > 0) {
          console.log(`VLLM: Found ${vllmModels.length} models`)
          vllmModels.forEach((model: any) => {
            models.push({
              name: model.id || model.name,
              details: {
                family: MODEL_FAMILIES.vllm
              }
            })
          })
        } else {
          // No models returned, use static fallback
          console.log('VLLM: No models returned from API, using static models')
          VLLM_MODELS.forEach((model) => {
            models.push({
              name: model,
              details: {
                family: MODEL_FAMILIES.vllm
              }
            })
          })
        }
      } else {
        console.warn(`VLLM: API returned ${response.status}, using static models`)
        // Fallback to static models
        VLLM_MODELS.forEach((model) => {
          models.push({
            name: model,
            details: {
              family: MODEL_FAMILIES.vllm
            }
          })
        })
      }
    } catch (error) {
      console.warn('VLLM: Failed to fetch models, using static models:', error instanceof Error ? error.message : 'Unknown error')
      // Fallback to static models
      VLLM_MODELS.forEach((model) => {
        models.push({
          name: model,
          details: {
            family: MODEL_FAMILIES.vllm
          }
        })
      })
    }
  }
}

  // ADD NVIDIA SUPPORT
  if (keys.nvidia.key) {
    try {
      const response = await fetch(`${keys.nvidia.endpoint || 'https://integrate.api.nvidia.com/v1'}/models`, {
        headers: {
          'Authorization': `Bearer ${keys.nvidia.key}`,
        }
      })

      if (response.ok) {
        const data = await response.json()
        const nvidiaModels = data.data || []
        nvidiaModels.forEach((model: any) => {
          models.push({
            name: model.id || model.name,
            details: {
              family: MODEL_FAMILIES.nvidia
            }
          })
        })
      } else {
        // Fallback to static models
        NVIDIA_MODELS.forEach((model) => {
          models.push({
            name: model,
            details: {
              family: MODEL_FAMILIES.nvidia
            }
          })
        })
      }
    } catch (error) {
      console.error('Failed to fetch NVIDIA models:', error)
      // Fallback to static models
      NVIDIA_MODELS.forEach((model) => {
        models.push({
          name: model,
          details: {
            family: MODEL_FAMILIES.nvidia
          }
        })
      })
    }
  }

  if (Array.isArray(keys.custom)) {
    await Promise.all(keys.custom.map(async (item) => {
      if (MODEL_FAMILIES.hasOwnProperty(item.aiType) && item.name && item.endpoint && item.key) {
        try {
          // Only attempt API call if modelsEndpoint is provided
          const modelsEndpoint = item.modelsEndpoint || "/models"
          const endpointWithSlash = item.endpoint.endsWith('/') ? item.endpoint : item.endpoint + '/'

          const normalizedModelsEndpoint = modelsEndpoint.startsWith('/') ? modelsEndpoint.substring(1) : modelsEndpoint
          const modelsUrl = new URL(normalizedModelsEndpoint, endpointWithSlash).toString()
          console.log(`Fetching models from ${modelsUrl}`)
          const response = await fetch(modelsUrl, {
            headers: {
              'Authorization': `Bearer ${item.key}`,
            }
          })

          if (response.ok) {
            const data: ModelApiResponse = await response.json()
            console.log(`${item.name} models:`, data.data.map(d => d.id || d.name))
            data.data.forEach(model => {
              models.push({
                name: model.id || model.name,
                details: {
                  family: item.name
                }
              })
            })
            return // Skip the fallback if API call succeeds
          } else {
            console.error(`Failed to fetch models for custom endpoint ${item.name}:`, response)
          }
        } catch (error) {
          console.error(`Failed to fetch models for custom endpoint ${item.name}:`, error)
        }

        // Fallback to predefined models list if API call fails or modelsEndpoint not provided
        if (Array.isArray(item.models) && item.models.length > 0) {
          item.models.forEach(model => {
            models.push({
              name: model,
              details: {
                family: item.name
              }
            })
          })
        }
      }
    }))
  }

  return models
})