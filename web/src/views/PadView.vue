<script setup lang="ts">
import { Lock, LockOpen, Users } from '@lucide/vue'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import * as Y from 'yjs'
import PadEditor from '@/components/PadEditor.vue'
import PasswordDialog from '@/components/PasswordDialog.vue'
import UnlockForm from '@/components/UnlockForm.vue'
import { Button } from '@/components/ui/button'
import { errorMessage, getPad, type PadInfo, WS_URL } from '@/lib/api'
import { PadProvider, type PadStatus } from '@/lib/pad-provider'
import { CLOSE } from '@/lib/protocol'
import { afterLock, type Creds, type Resume } from '@/lib/relock'

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
/** Our own password change, set until the 4409 it causes is handled (see afterLock). */
let changing: Promise<Resume> | null = null
/** Bumped on every (re)load, so answers for a previous pad are ignored. */
let generation = 0

function teardown() {
  generation++
  changing = null
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

/** Reconnects on the current Y.Doc (created if none), so edits not yet sent survive. */
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
    if (s === 'locked') void onLocked()
    else if (code === CLOSE.TOO_LARGE || code === 1009) toast.error(t('pad.tooLarge'))
    else if (s === 'error') toast.error(t('pad.connectionError'))
  })
}

async function onLocked() {
  const mine = generation
  const change = changing
  changing = null
  try {
    const next = await afterLock(info.value!, creds.value, change)
    if (mine !== generation) return
    info.value = next.info
    if (next.creds) return start(next.creds)
    // Someone else changed the password: this tab may no longer read the pad.
    provider = null
    doc.value = null
    people.value = 0
    dialogOpen.value = false
    toast.info(t('pad.locked'))
  } catch (error) {
    if (mine !== generation) return
    loadFailed.value = true
    toast.error(errorMessage(error))
  }
}

function onPasswordChange(pending: Promise<Resume>) {
  changing = pending
  pending.catch(() => undefined) // the dialog shows the error
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
        :creds="creds"
        :doc="doc"
        @change="onPasswordChange"
        @token="(token) => (creds = { ...creds, token })"
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
