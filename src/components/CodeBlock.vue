<script setup lang="ts">
import { ref } from 'vue';

type Lang = 'ts' | 'go' | 'py' | 'rs';
const tab = ref<Lang>('ts');
const tabs: { id: Lang; label: string }[] = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'py', label: 'Python' },
  { id: 'rs', label: 'Rust' },
];
</script>

<template>
  <div class="code-block">
    <div class="code-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="code-tab"
        :class="{ active: tab === t.id }"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <pre v-show="tab === 'ts'" class="code"><span class="k">import</span> { lookup, preload } <span class="k">from</span> <span class="s">"jpzip"</span>

<span class="c">// 単発検索 — /p/231.json を fetch して結果を抽出</span>
<span class="k">const</span> <span class="v">entry</span> = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"2310831"</span>)
<span class="c">// → { prefecture: "神奈川県", city: "横浜市中区",</span>
<span class="c">//     towns: [{ town: "矢口台", kana: "ヤグチダイ" }], ... }</span>

<span class="c">// オフライン化 — 全件を SDK 内にキャッシュ</span>
<span class="k">await</span> <span class="f">preload</span>({ scope: <span class="s">"all"</span> })

<span class="c">// 以降の lookup() はネットワーク不要</span>
<span class="k">const</span> <span class="v">e2</span> = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"1500001"</span>)</pre>

    <pre v-show="tab === 'go'" class="code"><span class="k">import</span> <span class="s">"github.com/jpzip/go"</span>

<span class="v">entry</span>, <span class="v">err</span> := jpzip.<span class="f">Lookup</span>(ctx, <span class="s">"2310831"</span>)
<span class="k">if</span> err != <span class="n">nil</span> { <span class="k">return</span> err }

<span class="c">// → entry.Prefecture = "神奈川県"</span>
<span class="c">//   entry.City       = "横浜市中区"</span>
<span class="c">//   entry.Towns[0]   = { Town: "矢口台", Kana: "ヤグチダイ" }</span>

<span class="c">// 永続キャッシュ付きクライアント</span>
<span class="v">client</span> := jpzip.<span class="f">New</span>(jpzip.<span class="f">WithCache</span>(fileCache))</pre>

    <pre v-show="tab === 'py'" class="code"><span class="k">from</span> jpzip <span class="k">import</span> lookup, preload

entry = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"2310831"</span>)
<span class="c"># → ZipcodeEntry(prefecture='神奈川県', city='横浜市中区',</span>
<span class="c">#     towns=[Town(town='矢口台', kana='ヤグチダイ', ...)])</span>

<span class="c"># preload して以降オフライン</span>
<span class="k">await</span> <span class="f">preload</span>(scope=<span class="s">"all"</span>)</pre>

    <pre v-show="tab === 'rs'" class="code"><span class="k">use</span> jpzip::{Client, Scope};

<span class="k">let</span> <span class="v">client</span> = Client::<span class="f">new</span>();
<span class="k">let</span> <span class="v">entry</span> = client.<span class="f">lookup</span>(<span class="s">"2310831"</span>).<span class="f">await</span>?;

<span class="c">// → ZipcodeEntry { prefecture: "神奈川県", city: "横浜市中区", .. }</span>

<span class="k">let</span> <span class="v">client</span> = Client::<span class="f">builder</span>()
    .<span class="f">cache</span>(jpzip::FileCache::<span class="f">at</span>(<span class="s">"./jpzip.cache"</span>))
    .<span class="f">build</span>();
client.<span class="f">preload</span>(Scope::All).<span class="f">await</span>?;</pre>

    <div class="code-out">
      <span class="arrow">↳</span>
      <span class="val">{ "prefecture": "神奈川県", "city": "横浜市中区", "towns": [{ "town": "矢口台" }] }</span>
    </div>
  </div>
</template>
