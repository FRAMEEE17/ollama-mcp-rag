<script lang="ts" setup>
import { object, string, array } from 'yup'
import type { ContextKeys } from '~/server/middleware/keys'
import * as CONFIG_MODELS from '~/config/models'

const props = defineProps<{
  value: ContextKeys['custom'][number]
}>()

const emits = defineEmits<{
  update: [ContextKeys['custom'][number]]
  remove: []
}>()

const toast = useToast()
const confirm = useDialog('confirm')
const { t } = useI18n()

// FIX: Add VLLM and NVIDIA to AI types
const aiTypes = Object.entries(CONFIG_MODELS.MODEL_FAMILIES)
  .filter(([key]) => key !== 'moonshot') // Keep moonshot filtered out
  .map(([value, label]) => ({ value, label }))

// FIX: Add VLLM and NVIDIA to default models map
const defaultModelsMap: Record<ContextKeys['custom'][number]['aiType'], string[]> = {
  openai: CONFIG_MODELS.OPENAI_GPT_MODELS,
  azureOpenai: CONFIG_MODELS.AZURE_OPENAI_GPT_MODELS,
  anthropic: CONFIG_MODELS.ANTHROPIC_MODELS,
  gemini: CONFIG_MODELS.GEMINI_MODELS,
  groq: CONFIG_MODELS.GROQ_MODELS,
  vllm: CONFIG_MODELS.VLLM_MODELS || [
    'google/gemma-2-27b-it',
    'google/gemma-2-9b-it',
    'google/gemma-2-2b-it'
  ],
  nvidia: CONFIG_MODELS.NVIDIA_MODELS || [
    'nvidia/nemotron-4-340b-instruct',
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-70b-instruct'
  ]
}

const defaultState: ContextKeys['custom'][number] = { 
  name: '', 
  aiType: 'openai', 
  endpoint: '', 
  key: '', 
  proxy: false, 
  models: [],
  modelsEndpoint: undefined
}

const defaultAiType = props.value.aiType || aiTypes[0].value
const state = reactive(Object.assign({}, defaultState, props.value, {
  aiType: defaultAiType
}))

const modelName = ref('')

const schema = computed(() => {
  return object({
    name: string().required(t('global.required')),
    aiType: string().required(t('global.required')),
    endpoint: string().url(t('global.invalidUrl')).required(t('global.required')),
    key: string().required(t('global.required')),
    modelsEndpoint: string().optional(),
    proxy: string().optional(),
  })
})

watch(() => state.aiType, (type) => {
  if (type !== 'openai') {
    state.models = defaultModelsMap[type] || []
  }
})

function onSubmit() {
  emits('update', { ...state })
}

function onAddModel() {
  const name = modelName.value.trim()
  if (!name) return
  
  if (state.models.includes(name)) {
    toast.add({ title: t('settings.modelNameExist'), color: 'red' })
    return
  }

  state.models.unshift(name)
  modelName.value = ''
}

function onToggleModel(model: string, event: Event) {
  const target = event.target as HTMLInputElement
  if (target.checked) {
    if (!state.models.includes(model)) {
      state.models.push(model)
    }
  } else {
    const index = state.models.indexOf(model)
    if (index > -1) {
      state.models.splice(index, 1)
    }
  }
}

function onRemove() {
  confirm(t('settings.ensureRemoveCustomService')).then(() => emits('remove'))
}
</script>

<template>
  <UForm :state="state" :schema="schema" @submit="onSubmit">
    <UFormGroup :label="t('settings.aiType')" class="mb-4" name="aiType">
      <USelectMenu v-model="state.aiType"
                   :options="aiTypes"
                   size="lg"
                   value-attribute="value"
                   option-attribute="label" />
    </UFormGroup>
    
    <!-- BASE URL FIELD -->
    <UFormGroup :label="t('settings.baseURL')" class="mb-4" name="endpoint">
      <UInput v-model.trim="state.endpoint" size="lg" :placeholder="t('global.required')" />
    </UFormGroup>
    
    <!-- MODELS ENDPOINT FIELD (Optional) -->
    <UFormGroup :label="t('settings.modelsEndpoint')" class="mb-4" name="modelsEndpoint">
      <UInput v-model.trim="state.modelsEndpoint" size="lg" :placeholder="t('global.optional') + ' (/models)'" />
    </UFormGroup>
    
    <!-- API KEY FIELD -->
    <UFormGroup :label="t('settings.apiKey')" class="mb-4" name="key">
      <UInput v-model.trim="state.key" size="lg" type="password" :placeholder="t('global.required')" />
    </UFormGroup>
    
    <!-- PROXY CHECKBOX -->
    <div class="my-4">
      <label class="flex items-center">
        <input type="checkbox" v-model="state.proxy" />
        <span class="ml-2 text-sm text-muted">({{ t('settings.proxyTips') }})</span>
      </label>
    </div>
    
    <!-- MODELS SECTION - Show for all AI types -->
    <div class="mb-4">
      <UFormGroup :label="t('settings.models')" class="mb-2">
        <!-- Show available models as checkboxes/selections -->
        <div v-if="defaultModelsMap[state.aiType]?.length" class="mb-3">
          <div class="text-sm text-gray-600 mb-2">{{ t('settings.availableModels') }}:</div>
          <div class="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
            <label v-for="model in defaultModelsMap[state.aiType]" :key="model" 
                   class="flex items-center space-x-2 p-2 bg-gray-50 dark:bg-gray-800 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
              <input type="checkbox" 
                     :checked="state.models.includes(model)"
                     @change="onToggleModel(model, $event)" />
              <span class="text-sm">{{ model }}</span>
            </label>
          </div>
        </div>
        
        <!-- Custom model input -->
        <div class="flex gap-2">
          <UInput v-model="modelName" :placeholder="t('settings.customModelName')" />
          <UButton @click="onAddModel" :disabled="!modelName.trim()">
            {{ t('global.add') }}
          </UButton>
        </div>
      </UFormGroup>
      
      <!-- Selected models list -->
      <div v-if="state.models.length" class="mt-3">
        <div class="text-sm text-gray-600 mb-2">{{ t('settings.selectedModels') }} ({{ state.models.length }}):</div>
        <div class="space-y-1 max-h-32 overflow-y-auto">
          <div v-for="(model, index) in state.models" :key="model" 
               class="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded model-name-item">
            <span class="text-sm">{{ model }}</span>
            <UButton size="xs" color="red" @click="state.models.splice(index, 1)">
              {{ t('global.remove') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>
    
    <div class="flex justify-between">
      <UButton type="submit">
        {{ t("global.save") }}
      </UButton>
      <UButton color="red" class="ml-2" @click="onRemove">
        {{ t('settings.removeCustomService') }}
      </UButton>
    </div>
  </UForm>
</template>

<style lang="scss" scoped>
.model-name-item {
  &:hover {
    button {
      display: block;
    }
  }
}
</style>