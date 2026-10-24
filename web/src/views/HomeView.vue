<script setup lang="ts">
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
      <p class="text-muted-foreground">{{ t('home.description') }}</p>
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
