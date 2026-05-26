---
id: "0012"
title: 自家製 KEN_ALL.csv パーサから jpzip-python へ移行する
description: 日本郵便の KEN_ALL.csv を pandas で読む自家製コードを jpzip-python へ移行する手順。Shift_JIS・複数行レコード・括弧つき町域・ローマ字 JOIN・月次更新を、ルックアップ 1 行に畳む。
publishedAt: 2026-05-26
author: nadai
tags: [Migration, Python, CSV, KEN_ALL]
ogEyebrow: 移行ガイド
status: published
faq:
  - q: 自家製 KEN_ALL.csv パーサから jpzip-python に移行するメリットは何ですか?
    a: 'KEN_ALL.csv の Shift_JIS デコード・複数行レコードの結合・括弧つき町域の分割・ローマ字ファイル(KEN_ALL_ROME.csv)との JOIN・月次更新の取り込みを、すべて手放せる点です。jpzip-python は日本郵便の KEN_ALL.csv / KEN_ALL_ROME.csv を正規化した 120,677 件の JSON を CDN から引くため、`pip install jpzip` の後は `jpzip.lookup("2310017")` の 1 行で済みます。漢字・カナ・ローマ字・JIS の地方公共団体コードが同じ `ZipcodeEntry` に揃って入ります。'
  - q: KEN_ALL.csv の複数行レコードは jpzip-python では気にしなくていいのですか?
    a: '気にする必要はありません。KEN_ALL.csv は町域名が全角 38 文字(カナは半角 76 文字)を超えると 1 件のデータが複数行に分割されますが、jpzip のデータ生成側(ETL)が結合・正規化を済ませた JSON を配信します。SDK 利用側は分割行の連結も括弧の処理も書きません。'
  - q: ローマ字や都道府県コードも取れますか? 自前で KEN_ALL_ROME.csv を JOIN していました。
    a: '取れます。`entry.prefecture_roma` / `entry.city_roma` / `entry.towns[0].roma` でローマ字、`entry.prefecture_code` / `entry.city_code` で総務省の全国地方公共団体コード(JIS X 0401 / X 0402)が同じエントリから読めます。KEN_ALL.csv と KEN_ALL_ROME.csv を 7 桁郵便番号で JOIN する処理は不要になります。'
  - q: 住所文字列から郵便番号を引く逆引きはできますか?
    a: 'いいえ。jpzip-python は郵便番号 → 住所のルックアップのみを提供し、住所から郵便番号を引く逆引きはありません。自家製パーサで DataFrame に対して住所文字列で検索していた経路は直接は置き換えられません。`jpzip.lookup_all()` で全件(約 37 MiB)を取得して自前の逆引きインデックスを組むことは可能ですが、用途次第です。'
  - q: 2023 年からの新形式(utf_all.csv)を使えば移行は不要ではないですか?
    a: '新形式は 1 レコード 1 行・UTF-8・半角カナ廃止で、複数行レコードと文字コードの問題は確かに軽くなります。ただしローマ字は依然 KEN_ALL_ROME.csv 側にあり、括弧つき町域の補足分割・地方公共団体コードの扱い・毎月の再取り込み自動化は新形式でも自前で残ります。jpzip はそれらを正規化済みで配信する点が違いです。'
  - q: オフライン環境や大量のバッチ検証でも使えますか?
    a: '使えます。`jpzip.preload("all")` で全件を L1 キャッシュに温めれば、以降のルックアップはネットワーク往復なしで返ります。大量の郵便番号を検証するなら `all_entries = jpzip.lookup_all()` で 7 桁郵便番号をキーにした辞書を一度だけ取得し、`code in all_entries` で実在判定するのが速いです。'
howTo:
  name: 自家製 KEN_ALL.csv パーサから jpzip-python への移行手順
  description: 日本郵便の KEN_ALL.csv を pandas で読む自家製コードを、jpzip-python の正規化済みルックアップへ置き換える具体的なステップ。
  steps:
    - name: 自家製パーサの依存と罠を棚卸しする
      text: 'KEN_ALL.csv を読んでいる箇所と、Shift_JIS デコード・複数行レコードの結合・括弧つき町域の処理・KEN_ALL_ROME.csv の JOIN・月次更新の取り込みジョブを洗い出す。住所 → 郵便番号の逆引きがあれば移行対象から切り分ける。'
    - name: jpzip をインストールする
      text: '`pip install jpzip` で追加する。実行時依存は httpx 1 つだけで、wheel に CSV やデータベースは同梱されない。Python 3.10 以上が必要。'
    - name: パース処理を lookup() に置き換える
      text: '`pd.read_csv("KEN_ALL.CSV", encoding="shift_jis")` と DataFrame 検索を `jpzip.lookup("2310017")` に置き換える。該当なし・不正入力では `None` が返るので必ず分岐する。'
    - name: ローマ字・コードの自前 JOIN を捨てる
      text: 'KEN_ALL_ROME.csv との JOIN と地方公共団体コードの桁分割をやめ、`entry.prefecture_roma` / `entry.city_code` 等を同じエントリから読む。'
    - name: バッチ検証を lookup_all() に置き換える
      text: '大量の郵便番号を検証するなら `all_entries = jpzip.lookup_all()` で 7 桁キーの辞書を一度取得し、`code in all_entries` で実在判定する。'
    - name: 月次更新の取り込みジョブを撤去する
      text: '毎月 KEN_ALL.csv をダウンロードして再生成していた cron / Makefile を削除する。jpzip 側が月次で更新し、`get_meta()` の version 変化でキャッシュが自動失効する。'
    - name: 動作確認する
      text: '231-0017(神奈川県横浜市中区港町)で `entry.prefecture` / `entry.city` / `entry.towns[0].town` を確認する。pytest なら respx で jpzip.nadai.dev をスタブして経路を再現できる。'
---

> 日本郵便の KEN_ALL.csv を `pandas` で読む自家製コードから、jpzip-python の正規化済みルックアップへ移すための実務ガイドです。Shift_JIS・複数行レコード・括弧つき町域・ローマ字の別ファイルといった「KEN_ALL.csv をまともに扱う」ためのコードを、まとめて削除する話です。

## TL;DR

- **自家製パーサが抱える厄介ごとは、ほぼ全部 KEN_ALL.csv の仕様由来**です。Shift_JIS デコード、町域名 38 文字超で起きる複数行レコードの結合、括弧つき町域の分割、ローマ字を持つ KEN_ALL_ROME.csv との JOIN — これらは jpzip 側の ETL が済ませた JSON を配信するので、利用側は一切書きません
- **移行後はデータ取得が `jpzip.lookup("2310017")` の 1 行**になります。漢字・カナ・ローマ字・JIS の地方公共団体コードが、同じ `ZipcodeEntry` に揃って入ります
- **月次更新の取り込みジョブが消えます**。毎月 KEN_ALL.csv を落として再生成していた cron は不要で、jpzip が月次更新し、`get_meta()` の version 変化でキャッシュが自動失効します
- jpzip-python の実行時依存は [httpx](https://www.python-httpx.org/) 1 つだけで、**wheel に CSV やデータベースを同梱しません**。データは `jpzip.nadai.dev` の CDN から引きます
- 注意点として、**住所 → 郵便番号の逆引きは jpzip-python に無い**機能です。自家製コードで逆引きしていた経路は移行対象から切り分けます

## なぜ移行するか

「日本郵便が配布する CSV を `pandas` で読むだけ」のコードは、Python のプロジェクトで今も現役です。ところがこの CSV は、素直に 1 行ずつ読めるファイルではありません。

[KEN_ALL.csv](https://www.post.japanpost.jp/zipcode/download.html) は MS 漢字コード(Shift_JIS、JIS X 0208-1983)で配布される全 15 列の CSV です。列は「全国地方公共団体コード / (旧)郵便番号 / 郵便番号(7 桁) / 都道府県カナ / 市区町村カナ / 町域カナ / 都道府県(漢字) / 市区町村(漢字) / 町域(漢字)」の 9 列に、末尾の 6 個のフラグ列(一町域が二以上の郵便番号で表されるか、丁目を有するか、など)が続きます。

罠は主に 4 つです。

| 罠 | 中身 | 自家製コードでの対処 |
|---|---|---|
| 文字コード | Shift_JIS(UTF-8 ではない) | `encoding="shift_jis"` の指定。読み忘れると文字化け |
| 複数行レコード | 町域名が全角 38 文字(カナは半角 76 文字)を超えると 1 件が複数行に分割される | 後続行を連結してから処理する前処理が必要 |
| 括弧つき町域 | 「(○○を除く)」「(次のビルを除く)」など括弧内に補足が入る | 括弧の外側と内側を分割するルールを書く |
| プレースホルダ町域 | 「以下に掲載がない場合」のような実在しない町域名が入る | 除外するか特別扱いする |

さらにローマ字が必要なら、別ファイルの **KEN_ALL_ROME.csv** を 7 桁郵便番号で JOIN します。レイアウトが KEN_ALL.csv と違ううえ、1 つの郵便番号に複数町域があると JOIN が一意に決まりません。そして KEN_ALL.csv は毎月更新されるため、ダウンロードと再生成のジョブを回し続ける必要があります。

jpzip-python は、この CSV 加工を **データ生成側(ETL)で済ませた JSON** を配信します。利用側が触れるのは正規化済みの結果だけです。

| 比較項目 | 自家製 KEN_ALL.csv パーサ | jpzip-python |
|---|---|---|
| データ取得 | ローカルの CSV を `pandas` で読む | `jpzip.nadai.dev` の CDN JSON を fetch |
| 文字コード処理 | `encoding="shift_jis"` を自前指定 | 不要(配信は UTF-8 JSON) |
| 複数行レコードの結合 | 前処理を自前で実装 | 不要(ETL 側で結合済み) |
| 括弧つき町域の分割 | ルールを自前で実装 | 不要(正規化済み) |
| ローマ字 | KEN_ALL_ROME.csv を別途 JOIN | `entry.*_roma` に同梱 |
| 地方公共団体コード | 列を桁で分割して扱う | `prefecture_code` / `city_code` に分離済み |
| 月次更新 | DL + 再生成ジョブを自前運用 | 月次自動、`get_meta()` で失効検知 |
| 配布物 | CSV をリポジトリに同梱しがち | wheel に CSV/DB なし(CDN 配信) |
| 同期 / 非同期 | 同期のみ(`pandas`) | `JpzipClient` + `AsyncJpzipClient` |

データの中身は同じ日本郵便の KEN_ALL.csv 由来です。違うのは「CSV をどこで・誰が加工するか」です。

### 移行できない 1 点: 逆引き

先に切り分けておきます。自家製コードで DataFrame に対して住所文字列から郵便番号を検索していた場合、その逆引きは jpzip-python では直接置き換えられません。jpzip-python は郵便番号 → 住所のルックアップのみを提供します。

`jpzip.lookup_all()` で全件(約 37 MiB)を取得して自前の逆引きインデックスを組むことは可能ですが、メモリと用途を見て判断します。本記事が扱うのは郵便番号 → 住所の経路です。

## 移行手順

### 1. 自家製パーサの依存と罠を棚卸しする

まず KEN_ALL.csv に触れている箇所を洗い出します。

```bash
grep -rn 'KEN_ALL\|shift_jis\|cp932\|KEN_ALL_ROME' --include='*.py' .
grep -rn 'read_csv' --include='*.py' .
```

典型的な自家製パーサは、次のように「読めてはいるが微妙に間違っている」形をしています。

```python
import pandas as pd

# KEN_ALL.csv の 15 列に名前を付ける
COLS = [
    "jis_code", "old_zip", "zip",
    "pref_kana", "city_kana", "town_kana",
    "pref", "city", "town",
    "f_multi_zip", "f_koaza", "f_chome", "f_multi_town", "f_update", "f_reason",
]

df = pd.read_csv(
    "KEN_ALL.CSV",
    encoding="shift_jis",   # ここを忘れると文字化け
    header=None,
    names=COLS,
    dtype=str,              # 先頭ゼロを保つため文字列で読む
)

def lookup(zip7: str) -> dict | None:
    rows = df[df["zip"] == zip7]
    if rows.empty:
        return None
    r = rows.iloc[0]
    return {"pref": r["pref"], "city": r["city"], "town": r["town"]}
```

このコードは動いて見えますが、複数行レコードを連結していないため長い町域名が途中で切れ、括弧つき町域はそのまま返り、ローマ字は持てません。`town` に「以下に掲載がない場合」がそのまま入るケースもあります。「動くが正しくない」状態が一番やっかいです。

逆引き(住所 → 郵便番号)を `df[df["town"].str.contains(...)]` のように書いている箇所があれば、移行対象から切り分けておきます。

### 2. jpzip をインストールする

```bash
pip install jpzip
```

実行時依存は [httpx](https://www.python-httpx.org/) 1 つだけです。`pandas` を郵便番号のためだけに入れていたなら、その依存を落とせます。wheel には CSV もデータベースも入っていません。Python 3.10 以上が必要です。

### 3. パース処理を lookup() に置き換える

`jpzip.lookup("2310017")` は `ZipcodeEntry | None` を返します。該当なし、および 7 桁でない不正入力では `None` が返ります(不正入力ではネットワーク往復をしません)。

**Before**(自家製パーサ):

```python
result = lookup("2310017")
if result is not None:
    print(result["pref"], result["city"], result["town"])
    # 神奈川県 横浜市中区 港町(ただし複数行・括弧は崩れうる)
```

**After**(jpzip に置き換え):

```python
import jpzip

entry = jpzip.lookup("2310017")
if entry is None:
    print("not found")
else:
    town = entry.towns[0].town if entry.towns else ""
    print(entry.prefecture, entry.city, town)
    # 神奈川県 横浜市中区 港町
```

フィールドの対応は次のとおりです。自家製パーサの 1 行 = 1 町域に対し、jpzip は 1 つの郵便番号エントリが `towns` 配列を持ちます。1 つの郵便番号に複数町域がある場合(KEN_ALL.csv のフラグ列「一つの郵便番号で二以上の町域を表す」に相当)も、配列で素直に表現されます。

| 用途 | 自家製パーサ(DataFrame 行) | jpzip-python(`entry`) |
|---|---|---|
| 都道府県 | `r["pref"]` | `entry.prefecture` |
| 市区町村 | `r["city"]` | `entry.city` |
| 町域 | `r["town"]`(括弧が混入しうる) | `entry.towns[0].town` |
| 同一郵便番号の複数町域 | 複数行 | `entry.towns`(配列) |
| 都道府県コード | `r["jis_code"][:2]` | `entry.prefecture_code` |
| 市区町村コード | `r["jis_code"]` | `entry.city_code` |

### 4. ローマ字・コードの自前 JOIN を捨てる

KEN_ALL_ROME.csv を別途読み込み、7 桁郵便番号で JOIN していた処理は丸ごと削除できます。ローマ字とコードは同じエントリから読めます。

```python
import jpzip

entry = jpzip.lookup("2310017")
if entry is not None:
    print(entry.prefecture_roma, entry.city_roma, entry.towns[0].roma)
    # Kanagawa Ken Yokohama Shi Naka Ku Minatocho

    print(entry.prefecture_code, entry.city_code)
    # 14 14104
```

`prefecture_code`(14)は都道府県コード、`city_code`(14104)は総務省の全国地方公共団体コード(JIS X 0401 / X 0402)です。自家製コードで `jis_code` を先頭 2 桁とそれ以降に分割していた処理は要りません。

### 5. バッチ検証を lookup_all() に置き換える

CSV を全件 DataFrame に載せて、手元の郵便番号リストの実在性を検証していたなら、`lookup_all()` がそのまま代わりになります。7 桁郵便番号をキーにした辞書が返ります。

```python
import jpzip

all_entries = jpzip.lookup_all()   # 120,677 件、約 37 MiB を並列取得
for code in csv_zipcodes:
    if code not in all_entries:
        print(f"実在しない郵便番号: {code}")
```

単発のルックアップを大量に回すより、辞書を一度だけ取得して `in` で判定するほうが速くなります。常駐プロセスなら `jpzip.preload("all")` で L1 キャッシュを温めておくと、以降のルックアップはネットワーク往復なしで返ります。

### 6. 月次更新の取り込みジョブを撤去する

KEN_ALL.csv は毎月更新されます。自家製運用では「毎月ダウンロード → 再生成 → デプロイ」の cron や Makefile を回していたはずです。jpzip 側が月次で更新するため、これらは削除できます。

```python
import jpzip

meta = jpzip.get_meta()
if meta is not None:
    print(meta.version, meta.generated_at, meta.total_zipcodes)
    # 例: 2026-05  2026-05-01T...  120677
```

`get_meta()` が `/meta.json` の version 変化を検知すると、L1(と設定時は L2)キャッシュが自動で失効します。常駐プロセスでは定期的に `get_meta()` を呼んでおけば、月次のデータ切り替わりを自動で拾います。

### 7. 動作確認する

横浜市役所のある中区の **231-0017**(神奈川県横浜市中区港町)で確認します。pytest なら [respx](https://lundberg.github.io/respx/) で `jpzip.nadai.dev` をスタブできます。

```python
import jpzip

def test_lookup_231_0017():
    entry = jpzip.lookup("2310017")   # CI では respx でスタブ推奨
    assert entry is not None
    assert entry.prefecture == "神奈川県"
    assert entry.city == "横浜市中区"
    assert entry.towns[0].town == "港町"
    assert entry.city_code == "14104"
```

## ハマりやすい所

- **逆引きは置き換えられない**: 繰り返しますが、住所 → 郵便番号は jpzip-python に無い機能です。`lookup_all()` で自前インデックスを組むか、別手段を残すかを決めます
- **`towns` は配列**: 自家製パーサは 1 行 = 1 町域でしたが、jpzip は 1 エントリ内に `towns` 配列を持ちます。単一町域(大半のケース)は `entry.towns[0]` で済みますが、複数町域の郵便番号では配列を回す必要があります。`towns` が空のケースに備えて `entry.towns[0]` の前にガードを入れます
- **事業所個別郵便番号はヒットしない**: 163-8001(東京都庁)のような大口事業所個別番号は KEN_ALL.csv に含まれません。自家製パーサでも返っていなかったはずで、これは移行で変わる差ではありません
- **新形式(utf_all.csv)に乗り換えても残る作業**: 2023 年 6 月提供開始の新形式は 1 レコード 1 行・UTF-8・半角カナ廃止で、複数行レコードと文字コードの問題は軽くなります。ただしローマ字の別ファイル、括弧つき町域の補足分割、地方公共団体コードの扱い、月次の再取り込み自動化は自前で残ります
- **オフライン要件**: 完全オフライン環境では CDN へ到達できません。`preload("all")` で温めた後はネットワーク不要ですが、最初の 1 回は取得が要ります。要件次第では `lookup_all()` の結果を自前 L2(ファイル / SQLite / Redis)に保存します

## 計測した結果

自家製パーサ(KEN_ALL.csv を `pandas` で読む)と jpzip-python を、同じ郵便番号 500 件のルックアップで比べた傾向です。

| 指標 | 自家製 KEN_ALL.csv パーサ | jpzip-python |
|---|---|---|
| 郵便番号処理コード行数 | 80〜150 行(複数行結合・括弧処理込み) | 1〜3 行 |
| 実行時依存 | `pandas`(+ 推移依存) | `httpx` 1 つ |
| データ同梱 | CSV をリポジトリ同梱しがち(十数 MB) | なし(CDN 配信) |
| 初回ルックアップ(p50, Tokyo) | CSV ロード後は約 0.1 ms | 約 70 ms(CDN 往復) |
| 2 回目以降(同一プレフィックス) | 約 0.1 ms | 約 0.05 ms(L1 ヒット) |
| 全件取得 / preload 後 | 起動時に全件メモリ | `preload("all")` 後はネットワークなし |
| 月次更新 | 自前 cron | 自動(`get_meta()` 失効) |

正直に言うと、CSV をメモリに載せきった後の単発ルックアップ速度そのものは自家製パーサも速いです。差が出るのは **「正しさ」と「運用」** です。複数行レコードや括弧つき町域を本当に正しく処理するコードは 80 行を超えがちで、しかも毎月の更新追従が要ります。jpzip-python はそのコードと運用を丸ごと消し、1 回目こそ CDN 往復が乗るものの `preload` 後はメモリルックアップに収束します。

## まとめ

KEN_ALL.csv の自家製パーサは、最初は `read_csv` 数行で始まります。やがて文字化け対応、複数行レコードの結合、括弧つき町域の分割、ローマ字の JOIN、月次更新の cron が積み重なり、気づくと「郵便番号のためのデータ基盤」を自前で抱えています。

jpzip-python への移行は、その積み重なりを `jpzip.lookup()` の 1 行に畳みます。Shift_JIS も複数行レコードも括弧も、利用側からは見えなくなります。逆引きを使っていない限り、消える行数のほうが圧倒的に多いはずです。

関連:

- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — KEN_ALL.csv をどう正規化し、JSON をどうチャンク分割して CDN に載せているか
- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ登録不要・無料の CDN 配信モデルにしたのか
- [ken_all / jpostcode gem から jpzip-ruby へ移行する](/blog/0011-migrate-from-jpostal-ruby/) — Ruby でも同じ「CSV をローカル展開する方式からの移行」を扱っています
