<script setup lang="ts">
import { EyeOff, Lock, UserX } from '@lucide/vue'
import { useTitle } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import GithubLink from '@/components/GithubLink.vue'
import LanguageToggle from '@/components/LanguageToggle.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { Toaster } from '@/components/ui/sonner'
import { isDark } from '@/lib/theme'

const { t } = useI18n()

// Tab title follows the language.
useTitle(computed(() => `${t('app.homeTitle')} — FoculessPad`))

const promises = [
  { key: 'app.noSignup', icon: UserX },
  { key: 'app.noTelemetry', icon: EyeOff },
  { key: 'app.endToEnd', icon: Lock },
]
</script>

<template>
  <div class="flex min-h-svh flex-col bg-background text-foreground">
    <header class="border-b">
      <div class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <a href="/" class="flex items-center gap-2 font-bold">
          <img src="/favicon.svg" alt="" class="size-7" />
          FoculessPad
        </a>
        <div class="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
          <GithubLink />
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <RouterView />
    </main>

    <footer class="border-t">
      <ul class="mx-auto flex max-w-5xl flex-wrap justify-center gap-2 px-4 py-6">
        <li
          v-for="promise in promises"
          :key="promise.key"
          class="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground"
        >
          <component :is="promise.icon" class="size-4" aria-hidden="true" />
          {{ t(promise.key) }}
        </li>
      </ul>
    </footer>

    <Toaster rich-colors position="top-center" :theme="isDark ? 'dark' : 'light'" />
  </div>
</template>
