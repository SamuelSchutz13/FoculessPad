<script setup lang="ts">
import { EditorView, keymap } from '@codemirror/view'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type * as Y from 'yjs'

const props = defineProps<{ doc: Y.Doc; label: string }>()
const host = useTemplateRef<HTMLDivElement>('host')
let view: EditorView | undefined

// Colors come from the style.css tokens, so light/dark follow the theme toggle.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.6' },
  '.cm-content': { padding: '1rem', caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--secondary)',
  },
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    extensions: [
      // No CodeMirror history: undo goes through Yjs, so it only undoes this tab's edits.
      keymap.of(yUndoManagerKeymap),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      theme,
      yCollab(props.doc.getText('content'), null),
    ],
  })
  view.focus()
})

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="min-h-[60vh] rounded-xl border bg-card text-base" />
</template>
