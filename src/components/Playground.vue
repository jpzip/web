<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { lookup, examples, type LookupResult } from '../lib/jpzip';

const zip = ref('');
const status = ref<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '待機中', kind: '' });
const metaLabel = ref('GET /p/—.json');
const loading = ref(false);
const result = ref<LookupResult | null>(null);
const time = ref('');

function sanitize(value: string): string {
  return value.replace(/\D/g, '').slice(0, 7);
}

async function query(value?: string) {
  const z = sanitize(value ?? zip.value);
  zip.value = z;
  if (z.length !== 7) {
    status.value = { text: 'format', kind: 'err' };
    result.value = { ok: false, zip: z, error: 'format' };
    return;
  }
  loading.value = true;
  status.value = { text: '検索中…', kind: '' };
  metaLabel.value = `GET /p/${z.slice(0, 3)}.json`;
  const r = await lookup(z);
  loading.value = false;
  result.value = r;
  time.value = new Date().toLocaleTimeString('ja-JP');
  if (!r.ok) {
    status.value = {
      text: r.error === 'not_found' ? '該当なし' : r.error,
      kind: 'err',
    };
    return;
  }
  status.value = { text: r.source === 'fallback' ? 'fallback' : 'OK', kind: 'ok' };
  metaLabel.value = `${r.source} · ${z}`;
}

function onInput(e: Event) {
  const t = e.target as HTMLInputElement;
  zip.value = sanitize(t.value);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') query();
}

onMounted(() => {
  setTimeout(() => query('2310831'), 200);
});
</script>

<template>
  <div class="pg">
    <div class="pg-left">
      <div class="pg-label">QUERY</div>
      <div class="pg-input-wrap">
        <div class="pg-input-inner">
          <div class="pg-prefix">〒</div>
          <input
            class="pg-input"
            inputmode="numeric"
            maxlength="7"
            placeholder="2310831"
            autocomplete="off"
            :value="zip"
            @input="onInput"
            @keydown="onKeydown"
          />
        </div>
        <button class="pg-go" @click="query()">引く →</button>
      </div>

      <div class="pg-label">EXAMPLES</div>
      <div class="pg-examples">
        <button
          v-for="ex in examples"
          :key="ex.zip"
          class="pg-example"
          @click="
            zip = ex.zip;
            query(ex.zip);
          "
        >
          <strong>{{ ex.zip }}</strong> · {{ ex.label }}
        </button>
      </div>

      <div class="pg-meta-strip">
        endpoint: <code>https://jpzip.nadai.dev/p/{prefix}.json</code><br />
        cache: <code>L1 memory · 24h CDN</code>
      </div>
    </div>

    <div class="pg-right">
      <div class="pg-right-head">
        <span class="status">
          <span class="dot" :class="status.kind"></span>
          <span>{{ status.text }}</span>
        </span>
        <span>{{ metaLabel }}{{ result && result.ok && time ? ` · ${time}` : '' }}</span>
      </div>
      <div class="pg-right-body">
        <template v-if="loading">
          <div class="pg-loading">fetching</div>
        </template>
        <template v-else-if="!result">
          <div class="pg-empty">
            <div>
              <div class="icon">〠</div>
              <div>左に郵便番号を入れて<br />「引く」を押してみよう</div>
            </div>
          </div>
        </template>
        <template v-else-if="!result.ok">
          <div class="pg-empty">
            <div>
              <div class="icon">{{ result.error === 'format' ? '×' : '〒' }}</div>
              <div>
                {{
                  result.error === 'not_found'
                    ? '該当する郵便番号がありません'
                    : result.error === 'format'
                      ? '7 桁の数字を入れてください'
                      : '取得に失敗しました'
                }}
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="pg-zip">
            <span class="mark">〒</span>{{ result.zip.slice(0, 3) }}-{{ result.zip.slice(3) }}
          </div>
          <div class="pg-addr">
            {{ result.entry.prefecture }}{{ result.entry.city }}{{ result.entry.towns[0]?.town ?? '' }}
          </div>
          <div class="pg-addr-sub">
            {{ result.entry.prefecture_kana }} {{ result.entry.city_kana }}
            {{ result.entry.towns[0]?.kana ?? '' }}
          </div>
          <dl class="pg-fields">
            <dt>roma</dt>
            <dd>
              {{ result.entry.prefecture_roma }}, {{ result.entry.city_roma
              }}{{ result.entry.towns[0]?.roma ? ', ' + result.entry.towns[0].roma : '' }}
            </dd>
            <dt>pref</dt>
            <dd>
              <code>{{ result.entry.prefecture_code || '—' }}</code>
            </dd>
            <dt>city</dt>
            <dd>
              <code>{{ result.entry.city_code }}</code>
            </dd>
            <dt>towns</dt>
            <dd>
              {{ result.entry.towns.length }} 件{{
                result.entry.towns[0]?.note ? ' · ' + result.entry.towns[0].note : ''
              }}
            </dd>
          </dl>
        </template>
      </div>
    </div>
  </div>
</template>
