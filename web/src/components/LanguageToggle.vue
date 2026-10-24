<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { type Locale, setLocale } from '@/i18n'

const { locale } = useI18n()

// Each option is labelled in its own language, as language pickers usually are.
const options: { locale: Locale; label: string }[] = [
  { locale: 'pt-BR', label: 'Português' },
  { locale: 'en', label: 'English' },
]
</script>

<template>
  <!-- SVG flags: Windows doesn't render flag emoji (it shows the letters "BR"/"US"). -->
  <div class="flex items-center gap-0.5 rounded-lg border p-0.5" role="group" aria-label="Idioma / Language">
    <button
      v-for="option in options"
      :key="option.locale"
      type="button"
      class="rounded-md p-1.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-secondary"
      :aria-pressed="locale === option.locale"
      :aria-label="option.label"
      :title="option.label"
      @click="setLocale(option.locale)"
    >
      <svg
        v-if="option.locale === 'pt-BR'"
        viewBox="0 0 20 14"
        class="h-3.5 w-5 rounded-[2px]"
        aria-hidden="true"
      >
        <rect width="20" height="14" fill="#009c3b" />
        <path d="M10 1.6 18.2 7 10 12.4 1.8 7z" fill="#ffdf00" />
        <circle cx="10" cy="7" r="3.1" fill="#002776" />
        <path d="M7.1 6.3a6 6 0 0 1 5.8 1" stroke="#fff" stroke-width=".6" fill="none" />
      </svg>
      <svg v-else viewBox="0 0 20 14" class="h-3.5 w-5 rounded-[2px]" aria-hidden="true">
        <rect width="20" height="14" fill="#fff" />
        <path
          d="M0 0h20v1.08H0zm0 2.15h20v1.08H0zm0 2.15h20v1.08H0zm0 2.16h20v1.07H0zm0 2.15h20v1.08H0zm0 2.15h20v1.08H0zm0 2.16h20V14H0z"
          fill="#b22234"
        />
        <rect width="8" height="7.54" fill="#3c3b6e" />
        <g fill="#fff">
          <circle cx="1.3" cy="1.2" r=".35" />
          <circle cx="3.3" cy="1.2" r=".35" />
          <circle cx="5.3" cy="1.2" r=".35" />
          <circle cx="7" cy="1.2" r=".35" />
          <circle cx="2.3" cy="2.6" r=".35" />
          <circle cx="4.3" cy="2.6" r=".35" />
          <circle cx="6.2" cy="2.6" r=".35" />
          <circle cx="1.3" cy="4" r=".35" />
          <circle cx="3.3" cy="4" r=".35" />
          <circle cx="5.3" cy="4" r=".35" />
          <circle cx="7" cy="4" r=".35" />
          <circle cx="2.3" cy="5.4" r=".35" />
          <circle cx="4.3" cy="5.4" r=".35" />
          <circle cx="6.2" cy="5.4" r=".35" />
          <circle cx="1.3" cy="6.6" r=".35" />
          <circle cx="3.3" cy="6.6" r=".35" />
          <circle cx="5.3" cy="6.6" r=".35" />
          <circle cx="7" cy="6.6" r=".35" />
        </g>
      </svg>
    </button>
  </div>
</template>
