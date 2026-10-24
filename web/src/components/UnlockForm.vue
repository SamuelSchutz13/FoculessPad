<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage, errorStatus, unlock } from '@/lib/api'
import { deriveKeys, fromB64url, toB64url } from '@/lib/crypto'
import { nextPaint } from '@/lib/utils'

const props = defineProps<{ name: string; salt: string }>()
const emit = defineEmits<{ unlocked: [creds: { token: string; encKey: CryptoKey }] }>()
const { t } = useI18n()

const password = ref('')
const busy = ref(false)

async function submit() {
  if (!password.value || busy.value) return
  busy.value = true
  try {
    await nextPaint() // Argon2 blocks the main thread for ~1 s
    const { authKey, encKey } = await deriveKeys(password.value, fromB64url(props.salt))
    const { token } = await unlock(props.name, toB64url(authKey))
    emit('unlocked', { token, encKey })
  } catch (error) {
    const status = errorStatus(error)
    toast.error(
      status === 401 ? t('unlock.wrong') : status === 429 ? t('unlock.tooMany') : errorMessage(error),
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Card class="mx-auto w-full max-w-sm">
    <CardHeader>
      <CardTitle>{{ t('unlock.title') }}</CardTitle>
      <CardDescription>{{ t('unlock.description') }}</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-3" @submit.prevent="submit">
        <Label for="unlock-password">{{ t('unlock.password') }}</Label>
        <Input
          id="unlock-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          autofocus
          :disabled="busy"
        />
        <Button type="submit" :disabled="busy || !password">
          {{ busy ? t('unlock.deriving') : t('unlock.submit') }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
