---
id: "0006"
title: "React Hook Form + Zod + jpzip で住所自動入力フォームを作る"
description: React Hook Form と Zod で郵便番号バリデーションを組み、jpzip-js の lookup と setValue で都道府県・市区町村・町域を埋める手順。二重 lookup の抑制と aria-busy によるアクセシビリティ対応も含む。
publishedAt: 2026-05-19
author: nadai
tags: [Framework Integration, React, TypeScript, Forms, Zod]
ogEyebrow: フレームワーク統合
status: draft
faq:
  - q: React Hook Form と Zod に jpzip を組み合わせるメリットは何ですか?
    a: 'バリデーション(7 桁数字の構文チェック)を Zod の同期スキーマに任せ、住所の自動入力(zipcode → 住所のルックアップ)を jpzip-js の非同期 lookup に任せる、という責務分離が綺麗に成立します。RHF 側は `register` と `setValue` だけ知っていれば良く、再レンダーは郵便番号フィールドのみに局所化できます。'
  - q: Zod の async refine で実在性チェックまで一気に書くべきですか?
    a: 'やめた方が良いです。Zod の async refine はフォーム submit 時か `mode: ''onBlur''` 時に走るので、ユーザーが入力中に L1 キャッシュ済みの住所を「先に埋めて見せる」UX とは噛み合いません。同期スキーマで構文だけ通し、住所の埋め込みは onBlur ハンドラの中で `lookup` を呼ぶ、という二段構えが扱いやすいです。'
  - q: 同じ郵便番号で onBlur が連続発火した場合の二重 lookup はどう防ぎますか?
    a: '直近に成功した郵便番号を `useRef` に保存し、同じ値なら早期 return します。L1 LRU が効くので 2 回目以降の lookup 自体は ~0.3 ms ですが、`setValue` の再発火を避けたい(ユーザーが手で町域を上書きしている場合に巻き戻る)という別の理由でも抑制すべきです。'
  - q: アクセシビリティで気をつけるべき点は?
    a: '郵便番号フィールドに `aria-busy` を立て、住所フィールドには `aria-live="polite"` を持つ status 領域を添えるのが最低限です。スクリーンリーダーが「住所が自動入力されました」と読み上げるようにしておくと、入力者が「あれ、勝手に変わった?」と混乱しません。'
  - q: サーバー側でも jpzip.lookup を呼ぶ必要はありますか?
    a: 'はい。クライアント側の自動入力はあくまで UX 補助で、信頼できる入力ではありません。サーバー側で `lookup(zipcode)` を呼んで、送信された都道府県・市区町村が CDN データと一致するかを最終確認します。Edge runtime でも動くので、Cloudflare Workers / Vercel Edge にバリデーション層を置くだけで済みます。'
  - q: Controlled (Controller) と uncontrolled (register) のどちらで実装すべきですか?
    a: '郵便番号と住所フィールドはいずれも素の `<input>` なので `register` (uncontrolled) で十分です。Controller が必要になるのは、Material UI や Headless UI の `<Combobox>` のように onChange の値の型がカスタムな場合だけです。本文の例も `register` ベースです。'
howTo:
  name: React Hook Form + Zod + jpzip で住所自動入力フォームを実装する
  description: Zod で郵便番号のバリデーションを定義し、onBlur で jpzip-js の lookup を呼んで都道府県・市区町村・町域を setValue で埋める実装手順。
  steps:
    - name: 依存のインストール
      text: 'react-hook-form / zod / @hookform/resolvers / @jpzip/jpzip の 4 つをインストールする。`npm install react-hook-form zod @hookform/resolvers @jpzip/jpzip` の 1 行で完結する。'
    - name: Zod スキーマで住所モデルを定義
      text: 'zipcode は `z.string().regex(/^\\d{7}$/)`、都道府県・市区町村・町域はそれぞれ `z.string().min(1)` で必須化する。実在性チェックはサーバー側に任せ、クライアントの Zod では構文のみを見る。'
    - name: useForm + zodResolver で配線
      text: '`useForm({ resolver: zodResolver(addressSchema), mode: ''onBlur'' })` で型推論 + バリデーションタイミングを決める。`register`、`setValue`、`watch` を使う。'
    - name: onBlur ハンドラで jpzip.lookup を呼ぶ
      text: '郵便番号フィールドの `onBlur` で `lookup(rawZipcode)` を呼び、結果を `setValue(''prefecture'', entry.prefecture, { shouldValidate: true })` のように都道府県・市区町村・町域に書き込む。`shouldValidate: true` で Zod の再バリデーションが走り、空フィールドエラーが解ける。'
    - name: 二重 lookup を `useRef` で抑制
      text: '直近に成功した zipcode を `useRef` に保存し、同じ値が再度入力された場合は lookup をスキップする。ユーザーが住所を手で書き換えた後に同じ郵便番号で onBlur が走ると、書き換えが巻き戻るのを防ぐ。'
    - name: アクセシビリティ属性を仕込む
      text: '郵便番号フィールドに `aria-busy={isLooking}` を立て、別途 `<output role="status" aria-live="polite">` で「住所を取得しました」「該当する郵便番号が見つかりません」を出力する。'
    - name: サーバー側で再検証
      text: 'submit 後のサーバー側エンドポイント(Hono / Express / Next.js Route Handler 等)で再度 `lookup(zipcode)` を呼び、送信された都道府県・市区町村が CDN データと一致するかを確認する。'
---

> React Hook Form のフォーム配線、Zod の型 + バリデーション、jpzip-js のルックアップを組み合わせて、郵便番号から住所を自動入力する典型構成を作ります。アクセシビリティと二重 lookup 抑制まで含めて、そのまま production に置ける形で書きます。

## TL;DR

- **責務分離**: 構文バリデーション(7 桁数字)は Zod、住所の自動入力(zipcode → 住所のルックアップ)は jpzip-js、フォーム状態は React Hook Form という三層に切り分ける
- Zod の **async refine で実在性チェックを書かない**。同期スキーマで構文だけ通し、`lookup` は onBlur ハンドラで呼ぶ
- `setValue('prefecture', ..., { shouldValidate: true })` で Zod の再バリデーションを走らせると、空フィールドエラーが自動的に解ける
- 直近成功した zipcode を **`useRef` で持って二重 lookup を抑制**。ユーザーが手で町域を編集した後の onBlur で書き換えが巻き戻るのを防ぐ
- `aria-busy` と `aria-live="polite"` の 2 つで **スクリーンリーダー対応** が完了する
- **サーバー側でも `lookup` を呼ぶ**。クライアント側の自動入力は UX 補助で、信頼できる入力ではない

## なぜこの構成か

「React で住所自動入力フォーム」と検索すると、`useState` + `useEffect` で fetch する素朴な実装が多数ヒットします。動きはしますが、バリデーション・型推論・再レンダー範囲・テスタビリティのどれをとっても本構成の方が綺麗です。

| 観点 | useState + useEffect | React Hook Form + Zod + jpzip |
|---|---|---|
| 型推論 | 手書きの interface に頼る | Zod スキーマから `z.infer` で自動 |
| バリデーション | submit 時に自前で書く | `zodResolver` で submit / blur / change の全タイミングを統一 |
| 再レンダー範囲 | 親が再レンダー → 全フィールドが再レンダー | フィールド単位(`register` ベースなら zipcode の onBlur で再レンダーするのは zipcode フィールドのみ) |
| エラー表示の局所化 | `errors.zipcode && <span>...</span>` を手で書く | `formState.errors.zipcode` を読むだけ |
| テスト容易性 | `act` のラップが煩雑 | RHF の `<FormProvider>` で済む |
| async lookup の重複抑制 | 自分で AbortController を握る | onBlur 内で `useRef` 1 行 |

非同期で「住所が後から埋まる」という体験は、フォームライブラリと相性が悪く見えますが、実は React Hook Form の `setValue` が `shouldValidate` / `shouldDirty` / `shouldTouch` のフラグを渡せるおかげで、副作用としての自動入力を Zod のバリデーション結果に綺麗に反映できます。

## 統合手順

### 1. 依存のインストール

```bash
npm install react-hook-form zod @hookform/resolvers @jpzip/jpzip
```

`@hookform/resolvers` は RHF と Zod を繋ぐアダプタです。`@jpzip/jpzip` は zero runtime deps なので、追加されるのは実質 RHF + Zod + jpzip の 3 つです。

### 2. Zod スキーマで住所モデルを定義

```ts
import { z } from 'zod';

export const addressSchema = z.object({
  zipcode: z
    .string()
    .regex(/^\d{7}$/, '7 桁の数字で入力してください'),
  prefecture: z.string().min(1, '都道府県を入力してください'),
  city: z.string().min(1, '市区町村を入力してください'),
  town: z.string().min(1, '町域・番地を入力してください'),
});

export type AddressFormValues = z.infer<typeof addressSchema>;
```

ポイント:

- **`async refine` で `lookup` を呼ばない**。Zod の async バリデーションは submit / blur 時にしか走らず、「ユーザーが入力した瞬間に住所を埋める」という UX とは噛み合いません。実在性チェックはサーバー側に寄せます
- `regex(/^\d{7}$/)` は **構文チェックのみ**。ハイフン入りの `231-0017` をそのまま受け取りたい場合は、後段の `setValueAs` で削ぎ落とします

### 3. useForm + zodResolver で配線

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addressSchema, type AddressFormValues } from './address-schema';

export const AddressForm = () => {
  const {
    register,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    mode: 'onBlur',
    defaultValues: { zipcode: '', prefecture: '', city: '', town: '' },
  });

  // 次のステップで埋める
  const onPostalBlur = async (_e: React.FocusEvent<HTMLInputElement>) => {
    /* TODO */
  };

  return (
    <form onSubmit={handleSubmit((v) => console.log(v))} className="h-adr">
      <label>
        郵便番号
        <input
          {...register('zipcode', {
            setValueAs: (v: string) => v.replace(/[^\d]/g, ''),
          })}
          onBlur={onPostalBlur}
          inputMode="numeric"
          maxLength={8}
        />
        {errors.zipcode && <span role="alert">{errors.zipcode.message}</span>}
      </label>
      {/* 都道府県・市区町村・町域は次のステップで埋める */}
    </form>
  );
};
```

`setValueAs` で `231-0017` のハイフンを削ぎ落としているので、フォーム状態としては常に 7 桁数字が保持されます。`maxLength={8}` はハイフン 1 文字ぶんの余裕です。

### 4. onBlur で `jpzip.lookup` を呼び setValue で埋める

```tsx
import { lookup } from '@jpzip/jpzip';

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/[^\d]/g, '');
  if (raw.length !== 7) return;
  const entry = await lookup(raw);
  if (!entry) {
    setStatus('該当する郵便番号が見つかりません');
    return;
  }
  setValue('prefecture', entry.prefecture, { shouldValidate: true });
  setValue('city', entry.city, { shouldValidate: true });
  setValue('town', entry.towns[0]?.town ?? '', { shouldValidate: true });
  setStatus('住所を取得しました');
};
```

`shouldValidate: true` を渡すと、Zod の `prefecture`・`city`・`town` の `min(1)` ルールが即時再評価されるので、`setValue` 直後に空フィールドエラーが自動で解けます。

複数町域(`towns.length > 1`)が返るケースは、`towns[0]` を採用するか、ユーザーに選択させる `<select>` を出すかをここで分岐します。今回は先頭採用で進めます。

### 5. 二重 lookup を `useRef` で抑制

`onBlur` は同じ値でもフォーカスが外れるたびに走るので、直近成功した zipcode を覚えておきます。

```tsx
import { useRef } from 'react';

const lastLookedUp = useRef<string>('');

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/[^\d]/g, '');
  if (raw.length !== 7) return;
  if (raw === lastLookedUp.current) return; // 同じ値なら何もしない
  lastLookedUp.current = raw;
  // ... lookup と setValue
};
```

L1 LRU が効いているので 2 回目以降の `lookup` 自体は **約 0.3 ms** で返りますが、`setValue` の再発火を避けるのが本来の目的です。ユーザーが町域を手で書き換えた後、もう一度郵便番号にフォーカスして外しただけで書き換えが巻き戻ると、入力者は混乱します。

### 6. アクセシビリティ属性を仕込む

```tsx
const [isLooking, setIsLooking] = useState(false);
const [status, setStatus] = useState<string>('');

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  // ... 早期 return 群
  setIsLooking(true);
  try {
    const entry = await lookup(raw);
    // ... setValue 群
  } finally {
    setIsLooking(false);
  }
};

return (
  <form onSubmit={handleSubmit((v) => console.log(v))} className="h-adr">
    <label>
      郵便番号
      <input
        {...register('zipcode', { setValueAs: (v: string) => v.replace(/[^\d]/g, '') })}
        onBlur={onPostalBlur}
        aria-busy={isLooking}
        inputMode="numeric"
        maxLength={8}
      />
    </label>
    <output role="status" aria-live="polite">{status}</output>
    {/* prefecture / city / town の input 群 */}
  </form>
);
```

- `aria-busy={isLooking}` — スクリーンリーダーが「ビジー状態」を読み上げ、補助技術側で待ちを表現できる
- `<output role="status" aria-live="polite">` — 「住所を取得しました」「該当する郵便番号が見つかりません」を非侵襲的に読み上げる
- `inputMode="numeric"` — モバイルで数字キーボードを開く(視覚補助とは別だが UX のため)

### 7. サーバー側で再検証

クライアント側 lookup はあくまで自動入力の UX 補助です。送信時にユーザーが住所を手で書き換えている可能性があるので、サーバー側で必ず再度 `lookup` を呼んで一致を確認します。

```ts
// app/api/address/route.ts (Next.js Route Handler の例)
import { lookup } from '@jpzip/jpzip';
import { addressSchema } from '@/lib/address-schema';

export async function POST(req: Request) {
  const body = addressSchema.parse(await req.json());
  const entry = await lookup(body.zipcode);
  if (!entry) {
    return Response.json({ error: 'invalid zipcode' }, { status: 422 });
  }
  if (entry.prefecture !== body.prefecture || entry.city !== body.city) {
    return Response.json({ error: 'address mismatch' }, { status: 422 });
  }
  // 永続化
  return Response.json({ ok: true });
}
```

`@jpzip/jpzip` は Edge runtime 互換なので、`export const runtime = 'edge'` を付けてもそのまま動きます。

## ハマりやすい所

- **`setValue` の `shouldValidate` を忘れる**: 付け忘れると、`setValue` 直後にエラー表示が古いまま残ります。`prefecture` の min(1) ルールに引っかかったまま「入力されているのに赤くなる」状態になります
- **`mode: 'onChange'` を選びがち**: 入力中に毎キーストロークでバリデーションが走ると、`zipcode` の regex エラーがチラつきます。`onBlur` が UX 上の正解です
- **`Controller` で実装する**: 素の `<input>` なら `register` で十分です。Material UI / Mantine などのカスタムコンポーネントを使う場合だけ `Controller` に切り替えます
- **複数町域の扱いを決め忘れる**: `towns.length > 1` の郵便番号(企業向け大口や一部の地域)で先頭採用すると、業務によっては誤入力につながります。ECサイトなら問題なし、行政手続きなら選択 UI が必要、と要件に応じて判断します
- **submit 時の再 lookup を忘れる**: クライアント側のキャッシュ済み住所をサーバー側がそのまま信用すると、ユーザーが手で書き換えた住所が DB に入ります。サーバー側 lookup は必須です
- **SSR でフォームを初期描画する**: Next.js App Router で `'use client'` 漏れがあると `useForm` が SSR 側で実行されてエラーになります。`AddressForm` コンポーネントの先頭に `'use client'` を付けます

## 動作確認

Vitest + React Testing Library で onBlur → lookup → setValue の経路をテストします。

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddressForm } from './AddressForm';

vi.mock('@jpzip/jpzip', () => ({
  lookup: vi.fn(async (zip: string) => {
    if (zip === '2310017') {
      return {
        prefecture: '神奈川県',
        city: '横浜市中区',
        towns: [{ town: '本町' }],
      };
    }
    return null;
  }),
}));

describe('AddressForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fills address fields after onBlur with a valid zipcode', async () => {
    const user = userEvent.setup();
    render(<AddressForm />);
    const zip = screen.getByLabelText('郵便番号');
    await user.type(zip, '231-0017');
    await user.tab(); // フォーカスを外して onBlur 発火
    await waitFor(() => {
      expect((screen.getByLabelText('都道府県') as HTMLInputElement).value).toBe('神奈川県');
    });
    expect(screen.getByRole('status')).toHaveTextContent('住所を取得しました');
  });

  it('shows error status when zipcode is not found', async () => {
    const user = userEvent.setup();
    render(<AddressForm />);
    await user.type(screen.getByLabelText('郵便番号'), '0000000');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('該当する郵便番号が見つかりません');
    });
  });
});
```

テストで使う郵便番号は **横浜市庁舎の 231-0017** に固定すると、見直し時に「これはなんの番号だっけ?」と迷いません。実 lookup を叩きたくないので `vi.mock` で `@jpzip/jpzip` 全体を差し替えています。MSW を使う場合は `https://jpzip.nadai.dev/p/231.json` をスタブします。

## まとめ

React Hook Form + Zod + jpzip は、「同期バリデーション」「非同期 lookup」「フォーム状態」の三役を綺麗に分担できる組み合わせです。Zod の async refine に lookup を押し込まず、onBlur ハンドラに置く判断さえできれば、残りはほぼ機械的に組み立てられます。

`useRef` で二重 lookup を抑制し、`aria-busy` と `aria-live` でスクリーンリーダー対応を済ませ、サーバー側で再 lookup する。3 点を押さえると、production フォームとしての品質に届きます。

関連:

- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ CDN 静的配信モデルなのか
- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — L1 LRU が `setValue` 連発に強い理由
- [Yubinbango から jpzip-js への移行](/blog/0005-migrate-from-yubinbango-js/) — class 属性ベースのレガシーフォームを残したまま移行する場合
