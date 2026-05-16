<script setup lang="ts">
import { ref } from 'vue';

type Lang = 'ts' | 'go' | 'py' | 'rs' | 'rb' | 'dart' | 'php' | 'swift';
const tab = ref<Lang>('ts');
const tabs: { id: Lang; label: string }[] = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'py', label: 'Python' },
  { id: 'rs', label: 'Rust' },
  { id: 'rb', label: 'Ruby' },
  { id: 'dart', label: 'Dart' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
];
</script>

<template>
  <div class="code-block">
    <div class="code-tabs">
      <div class="lights"><span></span><span></span><span></span></div>
      <button
        v-for="t in tabs"
        :key="t.id"
        class="code-tab"
        :class="{ active: tab === t.id }"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
      <div class="code-tab-spacer"></div>
      <span class="code-tab-meta">~30 LoC</span>
    </div>

    <pre v-show="tab === 'ts'" class="code"><span class="k">import</span> { lookup, preload } <span class="k">from</span> <span class="s">"@jpzip/jpzip"</span>

<span class="c">// 単発検索 — /p/231.json を fetch して結果を抽出</span>
<span class="k">const</span> <span class="v">entry</span> = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"2310017"</span>)
<span class="c">// → { prefecture: "神奈川県", city: "横浜市中区",</span>
<span class="c">//     towns: [{ town: "本町", kana: "ホンチョウ" }], ... }</span>

<span class="c">// オフライン化 — 全件を SDK 内にキャッシュ</span>
<span class="k">await</span> <span class="f">preload</span>({ scope: <span class="s">"all"</span> })

<span class="c">// 以降の lookup() はネットワーク不要</span>
<span class="k">const</span> <span class="v">e2</span> = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"1500001"</span>)</pre>

    <pre v-show="tab === 'go'" class="code"><span class="k">import</span> <span class="s">"github.com/jpzip/go"</span>

<span class="v">entry</span>, <span class="v">err</span> := jpzip.<span class="f">Lookup</span>(ctx, <span class="s">"2310017"</span>)
<span class="k">if</span> err != <span class="n">nil</span> { <span class="k">return</span> err }

<span class="c">// → entry.Prefecture = "神奈川県"</span>
<span class="c">//   entry.City       = "横浜市中区"</span>
<span class="c">//   entry.Towns[0]   = { Town: "本町", Kana: "ホンチョウ" }</span>

<span class="c">// 永続キャッシュ付きクライアント</span>
<span class="v">client</span> := jpzip.<span class="f">New</span>(jpzip.<span class="f">WithCache</span>(fileCache))</pre>

    <pre v-show="tab === 'py'" class="code"><span class="k">from</span> jpzip <span class="k">import</span> lookup, preload

entry = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">"2310017"</span>)
<span class="c"># → ZipcodeEntry(prefecture='神奈川県', city='横浜市中区',</span>
<span class="c">#     towns=[Town(town='本町', kana='ホンチョウ', ...)])</span>

<span class="c"># preload して以降オフライン</span>
<span class="k">await</span> <span class="f">preload</span>(scope=<span class="s">"all"</span>)</pre>

    <pre v-show="tab === 'rs'" class="code"><span class="k">use</span> jpzip::{JpzipClient};

<span class="k">let</span> <span class="v">client</span> = JpzipClient::<span class="f">builder</span>().<span class="f">build</span>();
<span class="k">let</span> <span class="v">entry</span> = client.<span class="f">lookup</span>(<span class="s">"2310017"</span>).<span class="f">await</span>?;

<span class="c">// → ZipcodeEntry { prefecture: "神奈川県", city: "横浜市中区", .. }</span>

client.<span class="f">preload</span>(<span class="s">"all"</span>).<span class="f">await</span>?;</pre>

    <pre v-show="tab === 'rb'" class="code"><span class="k">require</span> <span class="s">"jpzip"</span>

<span class="v">entry</span> = Jpzip.<span class="f">lookup</span>(<span class="s">"2310017"</span>)
<span class="c"># => #&lt;data Jpzip::ZipcodeEntry prefecture: "神奈川県",</span>
<span class="c">#      city: "横浜市中区", towns: [...]&gt;</span>

<span class="c"># preload して以降オフライン</span>
Jpzip.<span class="f">preload</span>(<span class="s">"all"</span>)</pre>

    <pre v-show="tab === 'dart'" class="code"><span class="k">import</span> <span class="s">'package:jpzip/jpzip.dart'</span>;

<span class="k">final</span> <span class="v">entry</span> = <span class="k">await</span> <span class="f">lookup</span>(<span class="s">'2310017'</span>);
<span class="c">// → ZipcodeEntry(prefecture: '神奈川県', city: '横浜市中区', ...)</span>

<span class="k">await</span> <span class="f">preload</span>(<span class="s">'all'</span>);  <span class="c">// L1 を全件で温める</span></pre>

    <pre v-show="tab === 'php'" class="code"><span class="k">use</span> <span class="k">function</span> Jpzip\lookup;
<span class="k">use</span> <span class="k">function</span> Jpzip\preload;

<span class="v">$entry</span> = <span class="f">lookup</span>(<span class="s">"2310017"</span>);
<span class="c">// → ZipcodeEntry { prefecture: "神奈川県", city: "横浜市中区", ... }</span>

<span class="f">preload</span>(<span class="s">"all"</span>);  <span class="c">// L1 を全件で温める</span></pre>

    <pre v-show="tab === 'swift'" class="code"><span class="k">import</span> Jpzip

<span class="k">let</span> <span class="v">entry</span> = <span class="k">try await</span> <span class="f">lookup</span>(<span class="s">"2310017"</span>)
<span class="c">// → ZipcodeEntry(prefecture: "神奈川県", city: "横浜市中区", ...)</span>

<span class="k">try await</span> <span class="f">preload</span>(<span class="s">"all"</span>)</pre>

    <div class="code-out">
      <span class="arrow">↳</span>
      <span class="val">{ "prefecture": "神奈川県", "city": "横浜市中区", "towns": [{ "town": "本町" }] }</span>
    </div>
  </div>
</template>
