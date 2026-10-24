<script setup lang="ts">
import { EyeOff, Lock, UserX } from '@lucide/vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizePadName } from '@/lib/pad-name'

const { t } = useI18n()
const router = useRouter()
const name = ref('')
const invalid = ref(false)

const promises = [
  { key: 'home.noSignup', icon: UserX },
  { key: 'home.noTelemetry', icon: EyeOff },
  { key: 'home.endToEnd', icon: Lock },
]

function open() {
  try {
    void router.push(`/${normalizePadName(name.value.trim())}`)
  } catch {
    invalid.value = true
  }
}
</script>

<template>
  <section class="mx-auto grid max-w-md gap-6 py-12">
    <div class="grid gap-2 text-center">
      <h1 class="text-3xl font-bold">{{ t('home.title') }}</h1>
      <ul class="mt-2 flex flex-wrap justify-center gap-2">
        <li
          v-for="promise in promises"
          :key="promise.key"
          class="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground"
        >
          <component :is="promise.icon" class="size-4" aria-hidden="true" />
          {{ t(promise.key) }}
        </li>
      </ul>
    </div>
    <form class="grid gap-2" novalidate @submit.prevent="open">
      <Label for="pad-name">{{ t('home.label') }}</Label>
      <div class="flex gap-2">
        <Input
          id="pad-name"
          v-model="name"
          :placeholder="t('home.placeholder')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          autofocus
          :aria-invalid="invalid"
          aria-describedby="pad-name-error"
          @input="invalid = false"
        />
        <Button type="submit">{{ t('home.open') }}</Button>
      </div>
      <p id="pad-name-error" class="min-h-5 text-sm text-destructive" aria-live="polite">
        {{ invalid ? t('home.invalid') : '' }}
      </p>
    </form>
  </section>
</template>
