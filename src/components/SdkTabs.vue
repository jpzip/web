<script setup lang="ts">
import { onMounted, ref } from 'vue';

// 主要 8 言語のタブ。他の言語 (Kotlin / C# / Dart / Elixir / Scala / C / C++ / Perl / R) は
// docs.astro 末尾の「その他の SDK」セクションでリンク集として案内している。
// セクション内 anchor (`sdk-functional`, `sdk-client`, …) は言語共通の ID なので、
// サイドバー TOC は言語非依存に書ける。タブを切り替えると同じ ID の中身が
// 現在の言語のものに差し替わる (v-if で 1 タブだけ DOM にいる状態)。
type Lang = 'ts' | 'go' | 'python' | 'rust' | 'ruby' | 'java' | 'php' | 'swift';

const langs: { id: Lang; label: string }[] = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'java', label: 'Java' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
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
  if (stored && langs.some((l) => l.id === stored)) {
    active.value = stored;
  }
  window.addEventListener('hashchange', scrollToHash);
});

function select(lang: Lang) {
  if (active.value === lang) return;

  // 言語ごとに pane の高さが違うので、active を切り替えるだけだと
  // 現在読んでいる位置が勝手にズレる。ビューポート上端のすぐ上にある
  // 見出しを覚えておき、切替後に同じ Y にくるよう scrollBy で補正する。
  let anchorId: string | null = null;
  let anchorOffset = 0;
  const headings = document.querySelectorAll<HTMLElement>(
    '.sdk-tab-pane h2[id], .sdk-tab-pane h3[id], .sdk-tab-pane h4[id]',
  );
  for (const h of headings) {
    const top = h.getBoundingClientRect().top;
    if (top > 0) break;
    anchorId = h.id;
    anchorOffset = top;
  }

  active.value = lang;
  localStorage.setItem('jpzip-sdk-lang', lang);

  if (anchorId) {
    requestAnimationFrame(() => {
      const el = document.getElementById(anchorId!);
      if (!el) return;
      const delta = el.getBoundingClientRect().top - anchorOffset;
      if (delta !== 0) window.scrollBy(0, delta);
    });
  }
}
</script>

<template>
  <div class="sdk-tabs">
    <div class="sdk-tab-bar" role="tablist">
      <button
        v-for="l in langs"
        :key="l.id"
        class="sdk-tab"
        :class="{ active: active === l.id }"
        role="tab"
        :aria-selected="active === l.id"
        @click="select(l.id)"
      >
        {{ l.label }}
      </button>
    </div>

    <div v-if="active === 'ts'" class="sdk-tab-pane"><slot name="ts" /></div>
    <div v-else-if="active === 'go'" class="sdk-tab-pane"><slot name="go" /></div>
    <div v-else-if="active === 'python'" class="sdk-tab-pane"><slot name="python" /></div>
    <div v-else-if="active === 'rust'" class="sdk-tab-pane"><slot name="rust" /></div>
    <div v-else-if="active === 'ruby'" class="sdk-tab-pane"><slot name="ruby" /></div>
    <div v-else-if="active === 'java'" class="sdk-tab-pane"><slot name="java" /></div>
    <div v-else-if="active === 'php'" class="sdk-tab-pane"><slot name="php" /></div>
    <div v-else-if="active === 'swift'" class="sdk-tab-pane"><slot name="swift" /></div>
  </div>
</template>
