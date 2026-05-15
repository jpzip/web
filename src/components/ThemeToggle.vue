<script setup lang="ts">
import { onMounted, ref } from 'vue';

const theme = ref<'light' | 'dark'>('light');

onMounted(() => {
  const saved = localStorage.getItem('jpzip-theme') as 'light' | 'dark' | null;
  const initial = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = initial;
  theme.value = initial;
});

function toggle() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('jpzip-theme', next);
  theme.value = next;
}
</script>

<template>
  <button class="theme-toggle" @click="toggle" aria-label="テーマ切替">{{ theme === 'dark' ? '☀' : '◐' }}</button>
</template>
