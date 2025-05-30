<script setup lang="ts">
import type { ContextKeys } from '~/server/middleware/keys'
import { keysStore, DEFAULT_KEYS_STORE } from '~/utils/settings'
import type { PickupPathKey, TransformTypes } from '~/types/helper'
import CreateCustomServer from './CreateCustomServer.vue'
import CustomServerForm from './CustomServerForm.vue'
import { deepClone } from '~/composables/helpers'

type PathKeys = PickupPathKey<Omit<ContextKeys, 'custom'>>

const { t } = useI18n()
const toast = useToast()
const modal = useModal()
const { loadModels } = useModels({ forceReload: true })

interface LLMListItem {
  key: string
  title: string
  fields: Array<{
    label: string
    value: PathKeys
    type: 'input' | 'password' | 'checkbox'
    placeholder?: string
    rule?: 'url'
  }>
}

const LLMList = computed<LLMListItem[]>(() => {
  return [
    // Ollama Server - Simple form
    {
      key: 'ollamaServer',
      title: t('settings.ollamaServer'),
      fields: [
        { label: t('settings.endpoint'), value: 'ollama.endpoint', type: 'input', placeholder: '', rule: 'url' },
        { label: t('global.userName'), value: 'ollama.username', type: 'input', placeholder: t('global.optional') },
        { label: t('global.password'), value: 'ollama.password', type: 'password', placeholder: t('global.optional') }
      ]
    },
    // OpenAI - Simple form
    {
      key: 'openAi',
      title: t('settings.openAi'),
      fields: [
        { label: t('settings.apiKey'), value: 'openai.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'openai.endpoint', type: 'input', placeholder: t('global.optional'), rule: 'url' },
        { label: t('settings.proxy'), value: 'openai.proxy', type: 'checkbox', placeholder: t('settings.proxyTips') },
      ]
    },
    // Azure OpenAI - Simple form
    {
      key: 'azureOpenAi',
      title: t('settings.azureOpenAi'),
      fields: [
        { label: t('settings.apiKey'), value: 'azureOpenai.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'azureOpenai.endpoint', type: 'input' },
        { label: t('settings.azureDeploymentName'), value: 'azureOpenai.deploymentName', type: 'input' },
        { label: t('settings.proxy'), value: 'azureOpenai.proxy', type: 'checkbox', placeholder: t('settings.proxyTips') },
      ]
    },
    // Anthropic - Simple form
    {
      key: 'anthropic',
      title: t('settings.anthropic'),
      fields: [
        { label: t('settings.apiKey'), value: 'anthropic.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'anthropic.endpoint', type: 'input', placeholder: t('global.optional'), rule: 'url' },
        { label: t('settings.proxy'), value: 'anthropic.proxy', type: 'checkbox', placeholder: t('settings.proxyTips') },
      ]
    },
    // Moonshot - Simple form
    {
      key: 'moonshot',
      title: t('settings.moonshot'),
      fields: [
        { label: t('settings.apiKey'), value: 'moonshot.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'moonshot.endpoint', type: 'input', placeholder: t('global.optional'), rule: 'url' },
      ]
    },
    // Gemini - Simple form
    {
      key: 'gemini',
      title: t('settings.gemini'),
      fields: [
        { label: t('settings.apiKey'), value: 'gemini.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'gemini.endpoint', type: 'input', placeholder: t('global.optional'), rule: 'url' },
        { label: t('settings.proxy'), value: 'gemini.proxy', type: 'checkbox', placeholder: t('settings.proxyTips') },
      ]
    },
    // Groq - Simple form
    {
      key: 'groq',
      title: t('settings.groq'),
      fields: [
        { label: t('settings.apiKey'), value: 'groq.key', type: 'password', placeholder: t('settings.apiKey') },
        { label: t('settings.endpoint'), value: 'groq.endpoint', type: 'input', placeholder: t('global.optional') },
        { label: t('settings.proxy'), value: 'groq.proxy', type: 'checkbox', placeholder: t('settings.proxyTips') },
      ]
    },
    // VLLM - Use CustomServerForm (empty fields)
    {
      key: 'vllm',
      title: 'VLLM',
      fields: []
    },
    // NVIDIA - Use CustomServerForm (empty fields)
    {
      key: 'nvidia',
      title: 'Nvidia', 
      fields: []
    },
  ]
})

const currentLLM = ref(LLMList.value[0].key)
const currentLLMFields = computed(() => LLMList.value.find(el => el.key === currentLLM.value)?.fields || [])
const state = reactive(getData())

// Only return custom server data for VLLM, NVIDIA, and actual custom servers
const currentCustomServer = computed(() => {
  // Handle VLLM with CustomServerForm
  if (currentLLM.value === 'vllm') {
    return {
      name: 'vllm',
      aiType: 'vllm' as const,
      endpoint: state['vllm.endpoint'] || 'http://localhost:8694/v1',
      key: state['vllm.key'] || '',
      proxy: state['vllm.proxy'] || false,      
      models: [],
      modelsEndpoint: ''
    }
  }
  
  // Handle NVIDIA with CustomServerForm  
  if (currentLLM.value === 'nvidia') {
    return {
      name: 'nvidia',
      aiType: 'nvidia' as const,
      endpoint: state['nvidia.endpoint'] || 'https://integrate.api.nvidia.com/v1',
      key: state['nvidia.key'] || '',
      proxy: state['nvidia.proxy'] || false,
      models: [],
      modelsEndpoint: ''
    }
  }
  
  // Handle actual custom servers
  return state.custom.find(el => el.name === currentLLM.value)
})

const validate = (data: typeof state) => {
  const errors: Array<{ path: string, message: string } | null> = []

  LLMList.value.flatMap(el => el.fields).filter(el => el.rule).forEach(el => {
    const key = el.value
    if (el.rule === 'url' && data[key]) {
      errors.push(checkHost(key, el.label))
    }
  })

  return errors.flatMap(el => el ? el : [])
}

const onSubmit = async () => {
  keysStore.value = recursiveObject(DEFAULT_KEYS_STORE, (keyPaths, value) => {
    const key = keyPaths.join('.') as keyof typeof state
    return key in state ? state[key] : value
  })
  loadModels()

  toast.add({ title: t(`settings.setSuccessfully`), color: 'green' })
}

function onAddCustomServer() {
  modal.open(CreateCustomServer, {
    onClose: () => modal.close(),
    onCreate: name => {
      if (state.custom.some(el => el.name === name)) {
        toast.add({ title: t(`settings.customServiceNameExists`), color: 'red' })
        return
      }
      const data: ContextKeys['custom'][number] = {
        name,
        aiType: 'openai',
        endpoint: '',
        key: '',
        models: [],
        proxy: false,
        modelsEndpoint: undefined,
      }
      state.custom.push(data)
      keysStore.value = Object.assign(keysStore.value, { custom: (keysStore.value.custom || []).concat(data) })
      currentLLM.value = name
      modal.close()
    }
  })
}

function onUpdateCustomServer(data: ContextKeys['custom'][number]) {
  // Handle VLLM updates
  if (data.name === 'vllm') {
    state['vllm.endpoint'] = data.endpoint
    state['vllm.key'] = data.key
    state['vllm.proxy'] = data.proxy ?? false
    
    keysStore.value.vllm = {
      endpoint: data.endpoint,
      key: data.key,
      proxy: data.proxy
    }
    
    loadModels()
    toast.add({ title: t(`settings.setSuccessfully`), color: 'green' })
    return
  }
  
  // Handle NVIDIA updates
  if (data.name === 'nvidia') {
    state['nvidia.endpoint'] = data.endpoint
    state['nvidia.key'] = data.key
    state['nvidia.proxy'] = data.proxy || false
    
    keysStore.value.nvidia = {
      key: data.key,
      endpoint: data.endpoint,
      proxy: data.proxy
    }
    
    loadModels()
    toast.add({ title: t(`settings.setSuccessfully`), color: 'green' })
    return
  }
  
  // Handle regular custom servers
  const index = state.custom.findIndex(el => el.name === currentCustomServer.value!.name)
  if (index >= 0) {
    state.custom[index] = data
    keysStore.value.custom.splice(index, 1, data)
    loadModels()
    toast.add({ title: t(`settings.setSuccessfully`), color: 'green' })
  }
}

function onRemoveCustomServer() {
  const index = state.custom.findIndex(el => el.name === currentCustomServer.value!.name)
  state.custom.splice(index, 1)
  keysStore.value.custom.splice(index, 1)
  currentLLM.value = LLMList.value[0].key
  loadModels()
}

const checkHost = (key: keyof typeof state, title: string) => {
  const url = state[key]
  if (!url || (typeof url === 'string' && /^https?:\/\//i.test(url))) return null

  return { path: String(key), message: t('settings.linkRuleMessage', [title]) }
}

function getData() {
  const data = LLMList.value.reduce((acc, cur) => {
    cur.fields.forEach(el => {
      (acc as any)[el.value] = el.value.split('.').reduce((a, c) => (a as any)[c], keysStore.value)
    })
    return acc
  }, {} as TransformTypes<PathKeys> & Pick<ContextKeys, 'custom'>)
  
  // Add VLLM fields manually since it has no fields array
  data['vllm.endpoint'] = keysStore.value.vllm?.endpoint || 'http://localhost:8694/v1'
  data['vllm.key'] = keysStore.value.vllm?.key || ''
  data['vllm.proxy'] = keysStore.value.vllm?.proxy || false
  
  // Add NVIDIA fields manually since it has no fields array
  data['nvidia.endpoint'] = keysStore.value.nvidia?.endpoint || 'https://integrate.api.nvidia.com/v1'
  data['nvidia.key'] = keysStore.value.nvidia?.key || ''
  data['nvidia.proxy'] = keysStore.value.nvidia?.proxy || false
  
  data.custom = deepClone(keysStore.value.custom || [])
  return data
}

function recursiveObject(obj: Record<string, any>, cb: (keyPaths: string[], value: any) => any) {
  const newObj = {} as any

  function recursive(oldObj: Record<string, any>, objPart: Record<string, any>, keyPaths: string[] = []) {
    for (const key in oldObj) {
      if (oldObj.hasOwnProperty(key)) {
        const value = oldObj[key]
        if (key === 'custom') {
          newObj[key] = cb([key], value)
        } else if (typeof value === 'object' && value !== null) {
          newObj[key] = {}
          recursive(oldObj[key], newObj[key], [...keyPaths, key])
        } else if (keyPaths.length === 0) {
          newObj[key] = cb([key], value)
        } else {
          objPart[key] = cb([...keyPaths, key], value)
        }
      }
    }
  }

  recursive(obj, {}, [])

  return newObj
}
</script>

<template>
  <ClientOnly>
    <div class="max-w-6xl mx-auto">
      <SettingsCard>
        <template #header>
          <div class="flex flex-wrap">
            <UButton v-for="item in LLMList"
                     :key="item.key"
                     :color="currentLLM == item.key ? 'primary' : 'gray'"
                     class="m-1"
                     @click="currentLLM = item.key">{{ item.title }}</UButton>
            <UButton v-for="item in state.custom" :key="item.name"
                     :color="currentLLM == item.name ? 'primary' : 'gray'"
                     class="m-1"
                     @click="currentLLM = item.name">{{ item.name }}</UButton>
            <UTooltip :text="t('settings.customApiService')">
              <UButton class="m-1" icon="i-material-symbols-add" color="gray" @click="onAddCustomServer"></UButton>
            </UTooltip>
          </div>
        </template>
        <div>
          <!-- Simple Form for most services -->
          <UForm v-if="currentLLMFields.length > 0" :validate="validate" :state="state" @submit="onSubmit">
            <template v-for="item in currentLLMFields" :key="item.value">
              <UFormGroup v-if="item.value.endsWith('proxy') ? $config.public.modelProxyEnabled : true" :label="item.label"
                          :name="item.value"
                          class="mb-4">
                <UInput v-if="item.type === 'input' || item.type === 'password'"
                        v-model.trim="(state[item.value] as string)"
                        :type="item.type"
                        :placeholder="item.placeholder"
                        size="lg"
                        :rule="item.rule" />
                <template v-else-if="item.type === 'checkbox'">
                  <label class="flex items-center">
                    <UCheckbox v-model="state[item.value] as boolean"></UCheckbox>
                    <span class="ml-2 text-sm text-muted">({{ item.placeholder }})</span>
                  </label>
                </template>
              </UFormGroup>
            </template>
            <div>
              <UButton type="submit">
                {{ t("global.save") }}
              </UButton>
            </div>
          </UForm>
          
          <!-- CustomServerForm for VLLM, NVIDIA, and custom servers -->
          <template v-else-if="currentCustomServer">
            <CustomServerForm :value="currentCustomServer"
                              :key="currentLLM"
                              @update="d => onUpdateCustomServer(d)" 
                              @remove="onRemoveCustomServer()" />
          </template>
        </div>
      </SettingsCard>
    </div>
  </ClientOnly>
</template>