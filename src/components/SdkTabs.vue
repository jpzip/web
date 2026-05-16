<script setup lang="ts">
import { onMounted, ref } from 'vue';

// 各言語タブの定義。`status: 'soon'` は別セッションで開発中の言語のプレースホルダ。
// セクション内 anchor (`sdk-functional`, `sdk-client`, …) は言語共通の ID なので、
// サイドバー TOC は言語非依存に書ける。タブを切り替えると同じ ID の中身が
// 現在の言語のものに差し替わる (v-if で 1 タブだけ DOM にいる状態)。
type Lang = 'ts' | 'go' | 'python' | 'rust' | 'ruby';

const langs: { id: Lang; label: string; status: 'stable' | 'soon' }[] = [
  { id: 'ts', label: 'TypeScript', status: 'stable' },
  { id: 'go', label: 'Go', status: 'stable' },
  { id: 'python', label: 'Python', status: 'soon' },
  { id: 'rust', label: 'Rust', status: 'soon' },
  { id: 'ruby', label: 'Ruby', status: 'soon' },
];

const active = ref<Lang>('ts');

function scrollToHash() {
  const h = location.hash.slice(1);
  if (!h) return;
  // v-if で content が差し替わるので 1 frame 待ってからスクロール
  requestAnimationFrame(() => {
    const el = document.getElementById(h);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

onMounted(() => {
  const stored = localStorage.getItem('jpzip-sdk-lang') as Lang | null;
  if (stored && langs.some((l) => l.id === stored && l.status === 'stable')) {
    active.value = stored;
  }
  window.addEventListener('hashchange', scrollToHash);
});

function select(lang: Lang, status: 'stable' | 'soon') {
  if (status === 'soon') return;
  if (active.value === lang) return;
  active.value = lang;
  localStorage.setItem('jpzip-sdk-lang', lang);
  // タブ切替後も hash の指す節 (例: #sdk-cache) は同じ ID で生きているので
  // そちらにスクロールし直す
  if (location.hash) scrollToHash();
}
</script>

<template>
  <div class="sdk-tabs">
    <div class="sdk-tab-bar" role="tablist">
      <button
        v-for="l in langs"
        :key="l.id"
        class="sdk-tab"
        :class="{ active: active === l.id, soon: l.status === 'soon' }"
        role="tab"
        :aria-selected="active === l.id"
        :disabled="l.status === 'soon'"
        @click="select(l.id, l.status)"
      >
        {{ l.label }}
        <span v-if="l.status === 'soon'" class="sdk-tab-pill">soon</span>
      </button>
    </div>

    <div v-if="active === 'ts'" class="sdk-tab-pane"><slot name="ts" /></div>
    <div v-else-if="active === 'go'" class="sdk-tab-pane"><slot name="go" /></div>
    <div v-else-if="active === 'python'" class="sdk-tab-pane"><slot name="python" /></div>
    <div v-else-if="active === 'rust'" class="sdk-tab-pane"><slot name="rust" /></div>
    <div v-else-if="active === 'ruby'" class="sdk-tab-pane"><slot name="ruby" /></div>
  </div>
</template>
