---
id: "0008"
title: "Address autofill with Next.js Server Actions (App Router)"
description: Build a postcode-to-address autofill form with Next.js 16 App Router Server Actions and jpzip-js — progressive enhancement that works without JavaScript, the Edge runtime, and server-side caching via the use cache directive.
lang: en
publishedAt: 2026-05-21
author: nadai
tags: [Framework Integration, Next.js, TypeScript, Forms, Edge]
ogEyebrow: Framework Integration
status: published
faq:
  - q: When should I use Server Actions instead of a client-side onBlur lookup?
    a: 'Server Actions run the lookup on the server, so the form works without JavaScript (progressive enhancement) and jpzip-js never ships in the client bundle. A client-side onBlur lookup gives faster per-keystroke feedback and avoids a server round trip. Choose Server Actions when you resolve the address on submit and want a server-only trust boundary; choose onBlur when you want to fill fields as the user types.'
  - q: Does a form built with useActionState really work without JavaScript?
    a: 'Yes. React wires `<form action={formAction}>` to a native form submission, so when JavaScript has not loaded the browser sends an ordinary POST, the server runs the Server Action, and the page re-renders with the new state. JavaScript-only touches such as disabling the button via `pending` simply do not apply until hydration — the form itself keeps working.'
  - q: Does jpzip-js run on the Next.js Edge runtime?
    a: 'Yes. `@jpzip/jpzip` has zero runtime dependencies and uses only the platform `fetch`, so it runs on a route marked `export const runtime = "edge"` with no extra work. Note that its L1 in-memory cache does not survive across short-lived Edge/serverless instances, so cross-request reuse should rely on the CDN HTTP cache (L3) or an L2 `PersistentCache` backed by a KV store.'
  - q: In Next.js 16, should I cache the lookup with use cache or unstable_cache?
    a: 'Use the `use cache` directive in Next.js 16. `unstable_cache` still works but was replaced by `use cache` (Cache Components) in v16. Wrap the lookup as `async function getAddress(zip) { "use cache"; cacheLife("weeks"); cacheTag("jpzip"); return lookup(zip); }` and enable `cacheComponents: true` in `next.config.ts`. Because `zipcode` is an argument, it becomes part of the cache key automatically.'
  - q: Is it fine to call jpzip.lookup directly inside a Server Action, and where is the trust boundary?
    a: 'It is fine. A Server Action runs on the server, so the lookup result is obtained without passing through the client and address resolution itself sits inside the trust boundary. Still, on final submit re-run `lookup(zipcode)` and confirm the submitted prefecture and city match the CDN data, because the user may have edited the town or street by hand.'
  - q: How do I handle a postcode that returns multiple towns?
    a: 'When `entry.towns` has more than one element (large-volume business codes or some areas), decide per requirement whether to take `towns[0]` or let the user pick from a `<select>`. For an e-commerce shipping address, taking the first entry rarely causes harm; for accuracy-sensitive cases like government forms, a selection UI is safer.'
howTo:
  name: Build an address autofill form with Next.js App Router Server Actions
  description: Call jpzip-js from a Server Action to autofill prefecture and city from a Japanese postcode, with progressive enhancement, the Edge runtime, and the use cache directive.
  steps:
    - name: Install jpzip-js and set the baseline
      text: 'Run `npm install @jpzip/jpzip`. It has zero runtime dependencies and runs on Node, Edge, or Workers. Assume a Next.js 16 App Router project with React 19.'
    - name: Write the address-resolving Server Action
      text: 'Add `"use server"` at the top of the file and define `resolveAddress(prevState, formData)`. Normalize `formData.get("zipcode")` to 7 digits, validate the syntax with `isValidZipcode`, call `lookup`, and return a state object that includes prefecture, city, and town.'
    - name: Wire it to a form for progressive enhancement
      text: 'In a client component call `useActionState(resolveAddress, emptyAddress)` and pass the returned `formAction` to `<form action={formAction}>`. Render the address fields as read-only inputs bound to state. The form still works through a native POST when JavaScript is disabled.'
    - name: Show pending and errors with useActionState
      text: 'Use the `pending` value from `useActionState` to disable the submit button and set `aria-busy`. Render `state.message` in an `aria-live="polite"` output so screen readers hear success and failure.'
    - name: Configure the Edge runtime and caching
      text: 'To run on the Edge, add `export const runtime = "edge"` to the route. For caching, enable `cacheComponents: true` in `next.config.ts` and wrap `getAddress` with `"use cache"` plus `cacheLife` and `cacheTag`. On the Edge, in-memory caches do not persist across instances, so push cross-request reuse to the CDN (L3) or a KV-backed L2.'
    - name: Re-validate on the server at submit time
      text: 'In the registration Server Action call `lookup(zipcode)` again and reject the submission if the posted prefecture and city do not match the CDN data. Do not trust the autofilled values shown on the client.'
---

> This guide builds a form that resolves a Japanese postcode (郵便番号) into a prefecture and city and autofills them, using Next.js 16 App Router Server Actions. Running the lookup on the server gives you two things at once: progressive enhancement that works without JavaScript, and a trust boundary that sits on the server side. It covers the Edge runtime and the `use cache` directive so the result is production-ready.

## TL;DR

- **Run the lookup on the server.** With Server Actions, `@jpzip/jpzip` never ships in the client bundle and address resolution itself sits inside the trust boundary
- `<form action={formAction}>` is wired by React to a native form submission, so it **works without JavaScript** (progressive enhancement). Using `useActionState` does not break that
- Bind the autofilled fields as **read-only inputs** driven by `state`, and keep the street/building line in a separate input — this avoids the `defaultValue`-vs-`value` trap
- `@jpzip/jpzip` has zero runtime dependencies and uses only `fetch`, so `export const runtime = "edge"` works as-is. The L1 in-memory cache, however, does not span Edge instances
- Cache the lookup with the **Next.js 16 `use cache` directive**. `unstable_cache` still works but was replaced in v16
- **Re-run the lookup on the server at submit time.** Even with a Server Action, the user may have hand-edited the address

## Why Server Actions

jpzip is a no-signup dataset project: 120,677 Japanese postal-code entries are published as static JSON on the `jpzip.nadai.dev` CDN, sharded by 3-digit prefix (for example `/p/231.json`), and `@jpzip/jpzip` looks them up by the 7-digit code. The usual "Next.js postcode autofill" tutorial calls that lookup from the client via `onChange`/`onBlur`. It works, but it pins the lookup to the browser. Server Actions move the same resolution to the server and align the form's submission boundary with the server's trust boundary.

Before deciding, compare it with the client-side onBlur approach (the React Hook Form setup in a separate post).

| Aspect | Client onBlur (RHF) | Server Actions |
|---|---|---|
| Where the lookup runs | In the browser | On the server |
| Without JavaScript | Does not work | Works (progressive enhancement) |
| Client JS bundle | Ships jpzip-js | Barely affected (the action is only referenced) |
| Per-keystroke feedback | Fast (no round trip) | Resolved on submit |
| Cache owner | Browser (L1 is per-tab) | Server (use cache / KV can span instances) |
| Trust boundary | Needs separate server re-validation | Lookup itself completes on the server |

If you want to fill fields character by character while typing, onBlur fits better. When you do not want to drop no-JS environments, do not want to ship jpzip-js to the client, or want address resolution centralized on the server, Server Actions line up. This post builds the latter.

## Integration steps

### 1. Install jpzip-js and set the baseline

```bash
npm install @jpzip/jpzip
```

`@jpzip/jpzip` has zero runtime dependencies and uses only the platform `fetch`. The same code runs on Node 18+, Bun, Deno, Cloudflare Workers, and Vercel Edge. The baseline here is a Next.js 16 App Router project on React 19.

### 2. Write the address-resolving Server Action

Put `'use server'` at the top of the file and use the signature `useActionState` expects: the previous state is the first argument and `FormData` is the second.

```ts
// app/actions.ts
'use server';

import { lookup, isValidZipcode } from '@jpzip/jpzip';

export type AddressState = {
  ok: boolean;
  message: string;
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
};

export const emptyAddress: AddressState = {
  ok: false,
  message: '',
  zipcode: '',
  prefecture: '',
  city: '',
  town: '',
};

export async function resolveAddress(
  _prev: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const zipcode = String(formData.get('zipcode') ?? '').replace(/\D/g, '');

  if (!isValidZipcode(zipcode)) {
    return { ...emptyAddress, zipcode, message: 'Enter 7 digits' };
  }

  const entry = await lookup(zipcode); // swapped for the use cache version in step 6
  if (!entry) {
    return { ...emptyAddress, zipcode, message: 'No matching postcode found' };
  }

  return {
    ok: true,
    message: 'Address resolved',
    zipcode,
    prefecture: entry.prefecture,
    city: entry.city,
    town: entry.towns[0]?.town ?? '',
  };
}
```

`isValidZipcode` is a helper bundled with jpzip-js that only checks the `/^\d{7}$/` syntax; existence is decided by whether `lookup` returns `null`. Because `lookup` returns `null` for anything that is not 7 digits without touching the network, stripping non-digits with `replace(/\D/g, '')` makes invalid input safe to reject.

### 3. Wire it to a form for progressive enhancement

`useActionState` runs in a client component. Pass its returned `formAction` to `<form action={...}>` and React wires the form for native submission.

```tsx
// app/address-form.tsx
'use client';

import { useActionState } from 'react';
import { resolveAddress, emptyAddress } from './actions';

export function AddressForm() {
  const [state, formAction] = useActionState(resolveAddress, emptyAddress);

  return (
    <form action={formAction} className="h-adr">
      <label>
        Postcode
        <input
          name="zipcode"
          defaultValue={state.zipcode}
          inputMode="numeric"
          maxLength={8}
          required
        />
      </label>
      <button type="submit">Look up address</button>

      <output role="status" aria-live="polite">{state.message}</output>

      {/* The three autofilled fields are read-only inputs bound to state */}
      <label>
        Prefecture
        <input name="prefecture" value={state.prefecture} readOnly />
      </label>
      <label>
        City / ward
        <input name="city" value={state.city} readOnly />
      </label>
      <label>
        Town
        <input name="town" value={state.town} readOnly />
      </label>

      {/* The street/building line is a separate input the user types */}
      <label>
        Street and building
        <input name="addressLine" />
      </label>
    </form>
  );
}
```

This is the core of progressive enhancement. If JavaScript is disabled, or has not loaded yet, pressing "Look up address" sends an ordinary POST. The server runs `resolveAddress` and returns a page that reflects the new `state`, so the address fields come back filled. With JavaScript on, React calls the same action via `fetch` and updates `state` without a full reload.

The three address fields use a controlled, read-only `value={state.xxx}` on purpose. `defaultValue` does not follow later state changes after mount, so fields that get overwritten by the lookup need a controlled `value`. The street line, by contrast, is unrelated to the lookup, so it lives in a separate `addressLine` input.

Looking up `231-0017` returns this from the CDN data:

```ts
const entry = await lookup('2310017');
`${entry.prefecture} ${entry.city} ${entry.towns[0].town}`;
// => 神奈川県 横浜市中区 港町
// (Kanagawa, Naka Ward of Yokohama, Minatochō — the Kannai area near Yokohama City Hall)
```

Pinning the example to `231-0017` (Minatochō, Naka Ward, Yokohama) keeps later reviews from asking "which postcode was this again?"

### 4. Show pending and errors with useActionState

`useActionState` returns `pending` as its third value. Use it for the in-flight UI.

```tsx
'use client';

import { useActionState } from 'react';
import { resolveAddress, emptyAddress } from './actions';

export function AddressForm() {
  const [state, formAction, pending] = useActionState(resolveAddress, emptyAddress);

  return (
    <form action={formAction} className="h-adr">
      <label>
        Postcode
        <input
          name="zipcode"
          defaultValue={state.zipcode}
          inputMode="numeric"
          maxLength={8}
          aria-busy={pending}
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Looking up…' : 'Look up address'}
      </button>
      <output role="status" aria-live="polite">{state.message}</output>
      {/* address fields, same as step 3 */}
    </form>
  );
}
```

`aria-busy={pending}` tells assistive tech that a lookup is in flight, and `<output role="status" aria-live="polite">` announces "Address resolved" or "No matching postcode found." `disabled={pending}` guards against double submission.

`pending` stays `false` while JavaScript is absent, so `disabled={pending}` does not break progressive enhancement: before hydration the button is enabled and the native submission goes through.

### 5. Run it on the Edge runtime

To put the route on the Edge runtime, add one line of route segment config.

```ts
// app/page.tsx
export const runtime = 'edge';
```

`@jpzip/jpzip` has zero runtime dependencies and uses only `globalThis.fetch`, so it runs on the Edge with no extra work. One caveat: jpzip-js keeps its L1 LRU cache in process memory, and Edge/serverless instances are short-lived, so it is not reused across requests. A second lookup on a warm instance returns in about 0.3 ms, but a cold instance fetches from the CDN again.

When you do want cross-instance reuse, plug jpzip-js's `PersistentCache` (L2) into a KV store. The key is the prefix bucket URL and the value is the raw JSON bytes.

```ts
// app/jpzip.ts
import { JpzipClient, type PersistentCache } from '@jpzip/jpzip';

// Cloudflare KV / Vercel KV as L2. KV access uses the platform binding.
const kvCache: PersistentCache = {
  async get(key) {
    const buf = await KV.get(key, 'arrayBuffer');
    return buf ? new Uint8Array(buf) : null;
  },
  async set(key, value) {
    await KV.put(key, value, { expirationTtl: 60 * 60 * 24 * 7 });
  },
  async delete(key) {
    await KV.delete(key);
  },
  async clear() {
    // Do not wipe everything; operate per-prefix with delete
  },
};

export const jpzip = new JpzipClient({ cache: kvCache });
```

Swap `lookup` inside the Server Action for `jpzip.lookup` and the first instance to fetch a prefix bucket writes it to KV, so other instances hit L2 and skip the CDN. Even without L2, the CDN HTTP cache (L3) is shared across every POP, so a cold instance still returns quickly from a CDN edge hit.

### 6. Cache the lookup with use cache

You can also cache the resolution on the Next.js server. In Next.js 16 the `use cache` directive (Cache Components) is the recommended path. Enable it in `next.config.ts` first.

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

Wrap the lookup in a function tagged with `'use cache'`.

```ts
// app/address-cache.ts
import { lookup } from '@jpzip/jpzip';
import { cacheLife, cacheTag } from 'next/cache';
import type { ZipcodeEntry } from '@jpzip/jpzip';

export async function getAddress(zipcode: string): Promise<ZipcodeEntry | null> {
  'use cache';
  cacheLife('weeks'); // comfortably shorter than the monthly data cycle
  cacheTag('jpzip'); // invalidate in bulk with revalidateTag('jpzip') on a data update
  return lookup(zipcode);
}
```

Replace `await lookup(zipcode)` in the step 2 action with `await getAddress(zipcode)` and you are done. Because `zipcode` is an argument, it is folded into the `use cache` key automatically, giving each postcode its own entry.

Inside a `use cache` scope you cannot read `cookies()` or `headers()`. Address resolution only needs the zipcode, so this constraint never bites, but the rule of thumb is to read request-specific values outside the scope and pass them in as arguments.

The older `unstable_cache` still works, but Next.js 16 replaced it with `use cache`. If you cannot migrate yet, `unstable_cache(async (zip) => lookup(zip), ['jpzip'], { revalidate: 604800, tags: ['jpzip'] })` keeps working for now.

Note that the in-memory storage behind `use cache` may not persist across requests on serverless/Edge; it does persist on a Node server or self-hosted setup. For Edge-centric deployments, lean on the CDN (L3) from step 5 or a KV-backed L2 as the primary cache layer.

### 7. Re-validate on the server at submit time

Even after the fields autofill, the user can hand-edit the town or street. A Server Action runs on the server, but that does not mean you can trust the displayed address. Re-run the lookup in the registration action and confirm the match.

```ts
// app/actions.ts (continued)
export async function register(_prev: unknown, formData: FormData) {
  const zipcode = String(formData.get('zipcode') ?? '').replace(/\D/g, '');
  const entry = await lookup(zipcode);

  if (!entry) {
    return { ok: false, message: 'Invalid postcode' };
  }
  if (
    entry.prefecture !== formData.get('prefecture') ||
    entry.city !== formData.get('city')
  ) {
    return { ok: false, message: 'Postcode and address do not match' };
  }

  // persist
  return { ok: true, message: 'Registered' };
}
```

Checking prefecture and city catches tampering from a form posted directly. The town is left to a non-strict comparison because users append a street number to it. To keep `resolveAddress` and `register` in a single form, give each submit button a `formAction` to dispatch the two actions (see the multiple submission types section of the React `<form>` docs).

## Pitfalls

- **Getting the action signature wrong.** An action called through `useActionState` takes the previous `state` first and `FormData` second. Passing `(formData) => ...` puts `state` where `formData` should be, and it breaks
- **Using `defaultValue` on autofilled fields.** `defaultValue` does not follow value changes after mount. Fields overwritten by the lookup need a controlled `value` (with `readOnly` if you want them uneditable). The street the user types belongs in a separate input to avoid interference
- **Marking autofilled fields `disabled`.** A `disabled` input is not submitted. If you only want it uneditable, use `readOnly`; its value is included in the POST
- **Reading `cookies()` / `headers()` inside `use cache`.** You cannot read them in scope. Read them outside and pass them as arguments. Values passed as arguments — like the zipcode — enter the cache key
- **Assuming in-memory caches span Edge instances.** Neither L1 nor the `use cache` in-memory store is guaranteed to persist across Edge/serverless instances. To span them, push to the CDN (L3) or a KV-backed L2
- **Forgetting to decide how to handle multiple towns.** Taking `towns[0]` for a postcode where `towns.length > 1` can autofill the wrong value. Take the first for e-commerce; show a `<select>` for government forms

## Verifying

`resolveAddress` is a plain function, so you can unit-test the logic by building a `FormData` and calling it directly. Mock `@jpzip/jpzip` to avoid hitting the real CDN.

```ts
// app/actions.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@jpzip/jpzip', () => ({
  isValidZipcode: (z: string) => /^\d{7}$/.test(z),
  lookup: vi.fn(async (zip: string) =>
    zip === '2310017'
      ? { prefecture: '神奈川県', city: '横浜市中区', towns: [{ town: '港町' }] }
      : null,
  ),
}));

import { resolveAddress, emptyAddress } from './actions';

describe('resolveAddress', () => {
  it('returns the address for a valid postcode', async () => {
    const fd = new FormData();
    fd.set('zipcode', '231-0017'); // hyphenated input is normalized
    const state = await resolveAddress(emptyAddress, fd);
    expect(state.prefecture).toBe('神奈川県');
    expect(state.city).toBe('横浜市中区');
    expect(state.town).toBe('港町');
    expect(state.message).toBe('Address resolved');
  });

  it('returns an error state for an unknown postcode', async () => {
    const fd = new FormData();
    fd.set('zipcode', '0000000');
    const state = await resolveAddress(emptyAddress, fd);
    expect(state.ok).toBe(false);
    expect(state.message).toBe('No matching postcode found');
  });
});
```

The `use cache`-wrapped `getAddress` assumes the Next.js runtime, so test it through a running app rather than in isolation. To verify progressive enhancement, disable JavaScript in your browser dev tools and confirm the address fields fill on submit — that is the final check of the no-JS path.

## Wrapping up

Building postcode autofill with Next.js Server Actions moves the lookup to the server and hands you progressive enhancement and an aligned trust boundary in one move. The pairing of `<form action={formAction}>` and `useActionState` satisfies both paths from a single component: a smooth, pending-aware UX when JavaScript is on, and a native submission when it is off.

Bind the autofilled fields as controlled, read-only inputs; on the Edge, do not count on in-memory caches and lean on the CDN (L3) or KV (L2); on Next.js 16, wrap the lookup with `use cache`. Add server-side re-validation at the registration submit and the form reaches production quality.

Related:

- [React Hook Form + Zod + jpzip](/blog/0006-react-hook-form-zod/) — the same lookup with a client-side onBlur
- [Rails + Hotwire + jpzip-ruby](/blog/0007-rails-hotwire-form/) — assembling the address fields server-side in another framework
- [The jpzip overview](/blog/0001-cloudflare-pages-micro-saas/) — why the CDN static-delivery model
- [Next.js: forms with Server Actions](https://nextjs.org/docs/app/guides/forms) — the official forms guide
- [Next.js: the use cache directive](https://nextjs.org/docs/app/api-reference/directives/use-cache) — the Cache Components reference
</content>
