<script setup lang="ts">
import { Lock, LockOpen, Users } from '@lucide/vue'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import * as Y from 'yjs'
import PadEditor from '@/components/PadEditor.vue'
import PasswordDialog, { type Creds } from '@/components/PasswordDialog.vue'
import UnlockForm from '@/components/UnlockForm.vue'
import { Button } from '@/components/ui/button'
import { errorMessage, getPad, type PadInfo, WS_URL } from '@/lib/api'
import { PadProvider, type PadStatus } from '@/lib/pad-provider'
import { CLOSE } from '@/lib/protocol'

const props = defineProps<{ name: string }>()
const { t } = useI18n()
const router = useRouter()

const info = ref<PadInfo | null>(null)
const loadFailed = ref(false)
const status = ref<PadStatus>('connecting')
const people = ref(0)
const doc = shallowRef<Y.Doc | null>(null)
// Token and key live in memory only: a reload asks for the password again.
const creds = shallowRef<Creds>({})
const dialogOpen = ref(false)
let provider: PadProvider | null = null
/** A password change of ours is in flight; its 4409 must not show the lock screen. */
let changing: Promise<Creds> | null = null
/** Bumped on every (re)load, so answers for a previous pad are ignored. */
let generation = 0

function teardown() {
  generation++
  provider?.destroy()
  provider = null
  doc.value = null
  people.value = 0
  dialogOpen.value = false
}

async function load() {
  teardown()
  const mine = generation
  info.value = null
  loadFailed.value = false
  try {
    const pad = await getPad(props.name)
    if (mine !== generation) return
    // Same pad whatever the case typed: the AAD and the URL both use the normalized name.
    if (pad.name !== props.name) return void router.replace(`/${pad.name}`)
    info.value = pad
    if (!pad.protected) start({})
  } catch (error) {
    if (mine !== generation) return
    loadFailed.value = true
    toast.error(errorMessage(error))
  }
}

function start(next: Creds) {
  provider?.destroy()
  creds.value = next
  doc.value ??= new Y.Doc()
  status.value = 'connecting'
  const p = new PadProvider({ url: WS_URL, name: info.value!.name, doc: doc.value, ...next })
  provider = p
  p.onPresence((n) => (people.value = n))
  p.onStatus((s, code) => {
    if (provider !== p) return
    status.value = s
    if (s === 'locked' && !changing) void relock()
    else if (code === CLOSE.TOO_LARGE || code === 1009) toast.error(t('pad.tooLarge'))
    else if (s === 'error') toast.error(t('pad.connectionError'))
  })
}

/** Someone else changed the password (or our token expired): ask for it again. */
async function relock() {
  await load()
  if (info.value?.protected) toast.info(t('pad.locked'))
}

async function onPasswordChange(pending: Promise<Creds>) {
  changing = pending
  const mine = generation
  try {
    const next = await pending
    if (mine !== generation) return
    info.value = { ...info.value!, protected: next.encKey !== undefined }
    start(next) // same Y.Doc, new token and key
  } catch {
    // The dialog shows the error; if the socket was locked meanwhile, it was someone else.
    if (mine === generation && status.value === 'locked') void relock()
  } finally {
    changing = null
  }
}

watch(() => props.name, load, { immediate: true })
onBeforeUnmount(teardown)
</script>

<template>
  <p v-if="loadFailed" class="text-center text-muted-foreground">{{ t('pad.loadError') }}</p>

  <template v-else-if="info">
    <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 class="mr-auto text-xl font-bold break-all">{{ info.name }}</h1>
      <template v-if="doc">
        <span class="text-sm text-muted-foreground" role="status">
          {{ t(`pad.status.${status}`) }}
        </span>
        <span class="flex items-center gap-1 text-sm text-muted-foreground">
          <Users class="size-4" aria-hidden="true" />
          {{ t('pad.people', people) }}
        </span>
        <Button
          variant="outline"
          size="icon"
          :disabled="status !== 'synced'"
          :aria-label="info.protected ? t('pad.managePassword') : t('pad.setPassword')"
          :title="info.protected ? t('pad.managePassword') : t('pad.setPassword')"
          @click="dialogOpen = true"
        >
          <Lock v-if="info.protected" aria-hidden="true" />
          <LockOpen v-else aria-hidden="true" />
        </Button>
      </template>
    </div>

    <template v-if="doc">
      <PadEditor :key="info.name" :doc="doc" :label="info.name" />
      <PasswordDialog
        v-model:open="dialogOpen"
        :name="info.name"
        :protected="info.protected"
        :token="creds.token"
        :doc="doc"
        @change="onPasswordChange"
      />
    </template>
    <UnlockForm
      v-else-if="info.protected && info.salt"
      :name="info.name"
      :salt="info.salt"
      @unlocked="start"
    />
  </template>
</template>
