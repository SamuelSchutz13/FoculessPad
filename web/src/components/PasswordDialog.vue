<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage, removePassword, setPassword } from '@/lib/api'
import { deriveKeys, encrypt, randomSalt, toB64url } from '@/lib/crypto'
import { type Creds, type Resume, withFreshToken } from '@/lib/relock'
import { nextPaint } from '@/lib/utils'

const props = defineProps<{ name: string; protected: boolean; creds: Creds; doc: Y.Doc }>()
const emit = defineEmits<{
  /** Emitted as the request starts: the server closes our socket (4409) before it answers. */
  change: [next: Promise<Resume>]
  /** Our token had expired and was renewed with the kept authKey. */
  token: [token: string]
}>()
const authed = <T,>(request: (token?: string) => Promise<T>) =>
  withFreshToken(props.name, props.creds, request, (token) => emit('token', token))
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const password = ref('')
const confirm = ref('')
const busy = ref(false)
const tried = ref(false)
const problem = computed(() =>
  !password.value
    ? t('password.empty')
    : password.value !== confirm.value
      ? t('password.mismatch')
      : '',
)

watch(open, () => {
  password.value = confirm.value = ''
  tried.value = false
})

async function run(work: () => Promise<Resume>, done: string) {
  busy.value = true
  try {
    await nextPaint() // Argon2 blocks the main thread for ~1 s
    const next = work()
    emit('change', next)
    await next
    open.value = false
    toast.success(done)
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    busy.value = false
  }
}

function submitPassword() {
  tried.value = true
  if (problem.value || busy.value) return
  void run(
    async () => {
      const salt = randomSalt()
      const { authKey, encKey } = await deriveKeys(password.value, salt)
      const snapshot = await encrypt(encKey, Y.encodeStateAsUpdate(props.doc), props.name)
      const body = { salt: toB64url(salt), authKey: toB64url(authKey), snapshot: toB64url(snapshot) }
      const session = await authed((token) => setPassword(props.name, body, token))
      const info = { name: props.name, protected: true, salt: toB64url(salt) }
      return { info, creds: { token: session.token, encKey, authKey } }
    },
    props.protected ? t('password.changeDone') : t('password.setDone'),
  )
}

function remove() {
  if (busy.value) return
  void run(async () => {
    // Sent in the clear on purpose: without a password the server keeps readable state.
    const state = toB64url(Y.encodeStateAsUpdate(props.doc))
    await authed((token) => removePassword(props.name, state, token))
    return { info: { name: props.name, protected: false, salt: null }, creds: {} }
  }, t('password.removeDone'))
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {{ props.protected ? t('password.titleManage') : t('password.titleSet') }}
        </DialogTitle>
        <DialogDescription class="font-medium text-destructive">
          {{ t('password.warning') }}
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-3" @submit.prevent="submitPassword">
        <Label for="new-password">{{ t('password.password') }}</Label>
        <Input
          id="new-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          :disabled="busy"
        />
        <Label for="confirm-password">{{ t('password.confirm') }}</Label>
        <Input
          id="confirm-password"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          :disabled="busy"
          :aria-invalid="tried && !!problem"
          aria-describedby="password-problem"
        />
        <p id="password-problem" class="min-h-5 text-sm text-destructive" aria-live="polite">
          {{ tried ? problem : '' }}
        </p>
        <p v-if="props.protected" class="text-xs text-muted-foreground">
          {{ t('password.removeHint') }}
        </p>
        <DialogFooter class="gap-2">
          <Button
            v-if="props.protected"
            type="button"
            variant="destructive"
            :disabled="busy"
            @click="remove"
          >
            {{ t('password.remove') }}
          </Button>
          <Button type="submit" :disabled="busy">
            <template v-if="busy">{{ t('password.working') }}</template>
            <template v-else>
              {{ props.protected ? t('password.change') : t('password.set') }}
            </template>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
