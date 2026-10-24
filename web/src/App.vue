<script setup lang="ts">
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
useTitle(computed(() => `${t('app.homeTitle')} — FoculessPad`))</script>

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
      <p class="mx-auto max-w-5xl px-4 py-6 text-center text-sm text-muted-foreground">
        {{ t('app.footer') }}
      </p>
    </footer>

    <Toaster rich-colors position="top-center" :theme="isDark ? 'dark' : 'light'" />
  </div>
</template>
