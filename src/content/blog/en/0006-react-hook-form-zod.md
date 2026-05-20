---
id: "0006"
title: "Address auto-fill in React Hook Form with Zod and jpzip"
description: How to wire jpzip-js into a React Hook Form with a Zod schema. Covers postcode validation, onBlur lookup, setValue auto-fill, double-fetch suppression, and aria-busy for accessibility.
lang: en
publishedAt: 2026-05-19
author: nadai
tags: [Framework Integration, React, TypeScript, Forms, Zod]
ogEyebrow: Framework integration
status: published
faq:
  - q: Why pair React Hook Form, Zod, and jpzip rather than rolling your own?
    a: 'Clean separation of concerns: Zod owns synchronous validation (the 7-digit syntax), jpzip-js owns the asynchronous postcode → address lookup, and React Hook Form owns form state. The form component only needs `register` and `setValue`, and rerenders stay scoped to the postcode field instead of cascading through the whole form.'
  - q: Should I put the lookup inside a Zod async refine?
    a: 'No. Zod async refines run at submit time or on blur, which is incompatible with the UX of "fill the address as soon as the user finishes typing the postcode." Keep the Zod schema synchronous (syntax only) and call `lookup` from the onBlur handler. Real existence checks belong on the server.'
  - q: How do I avoid duplicate lookups when onBlur fires repeatedly?
    a: 'Store the last successfully-looked-up postcode in a `useRef` and early-return when the value matches. The L1 LRU makes repeat lookups effectively free (~0.3 ms), but the real reason to gate is `setValue`: re-applying values would clobber any manual edits the user made to the town field after the initial auto-fill.'
  - q: What is the accessibility baseline for this pattern?
    a: 'Set `aria-busy={isLooking}` on the postcode input while the network request is in flight, and place an `<output role="status" aria-live="polite">` next to it that announces "Address filled" or "Postcode not found." Screen-reader users then hear the implicit field change instead of being surprised by it.'
  - q: Do I still need to call `lookup` on the server?
    a: 'Yes. Client-side auto-fill is a UX convenience, not trusted input. On submit, re-run `lookup(zipcode)` server-side and reject the request if the submitted prefecture or city does not match the CDN data. `@jpzip/jpzip` works on Edge runtimes, so Cloudflare Workers or Vercel Edge can host the validation layer.'
  - q: Should I use `Controller` or `register` for the inputs?
    a: 'Use `register` (uncontrolled). The postcode and address fields are plain `<input>` elements, so the lighter API is enough. Switch to `Controller` only when you wrap a third-party component (Material UI, Headless UI Combobox, etc.) whose onChange signature is custom.'
howTo:
  name: Build an address auto-fill form with React Hook Form, Zod, and jpzip
  description: Set up a Zod schema for postcode + address validation and wire jpzip-js into the onBlur handler of the postcode field to auto-fill prefecture, city, and town via setValue.
  steps:
    - name: Install dependencies
      text: 'Install all four packages in one go: `npm install react-hook-form zod @hookform/resolvers @jpzip/jpzip`. `@hookform/resolvers` is the adapter that plugs a Zod schema into React Hook Form.'
    - name: Define the Zod schema for the address
      text: 'Use `z.string().regex(/^\\d{7}$/)` for the postcode and `z.string().min(1)` for prefecture, city, and town. Keep this synchronous — defer real existence checks to the server.'
    - name: Wire up useForm with zodResolver
      text: 'Call `useForm({ resolver: zodResolver(addressSchema), mode: ''onBlur'' })`. Use `register` for the inputs and `setValue` to apply lookup results.'
    - name: Call jpzip.lookup in the onBlur handler
      text: 'Strip non-digits, ensure the result is 7 characters, call `lookup(raw)`, and on success call `setValue(''prefecture'', entry.prefecture, { shouldValidate: true })` (and the same for city and town). The `shouldValidate: true` flag re-runs the Zod rules and clears stale required-field errors.'
    - name: Suppress duplicate lookups with useRef
      text: 'Cache the last successful postcode in a `useRef`. If the postcode has not changed on this blur cycle, skip the lookup so manual edits to the town field are not overwritten.'
    - name: Add accessibility attributes
      text: 'Toggle `aria-busy` on the postcode field while the request is in flight. Render an `<output role="status" aria-live="polite">` element that announces "Address filled" on success or "Postcode not found" on `null`.'
    - name: Re-validate on the server
      text: 'In the submit endpoint (Hono / Express / Next.js Route Handler / Vercel Edge), call `lookup(zipcode)` again and compare against the submitted prefecture and city. Reject mismatches as 422.'
---

> The canonical React stack for "postcode in, address auto-filled" is React Hook Form + Zod + a postcode SDK. This article wires `@jpzip/jpzip` into that stack with the accessibility and duplicate-lookup details that the typical "useState + useEffect" article skips.

## TL;DR

- **Separate three concerns**: Zod for synchronous syntax validation (7-digit numeric), jpzip-js for asynchronous postcode → address lookup, and React Hook Form for form state
- **Do not put `lookup` inside a Zod async refine.** Keep the schema synchronous and call `lookup` from the onBlur handler instead
- `setValue('prefecture', ..., { shouldValidate: true })` re-runs Zod's rules and clears the "required field" error the moment the address arrives
- **Use `useRef` to suppress duplicate lookups.** The L1 LRU makes repeat requests free, but you also want to avoid overwriting manual edits the user made to the town field
- **`aria-busy` plus an `aria-live="polite"` status output** is the minimum accessibility surface
- **Re-run `lookup` on the server.** The client-side auto-fill is a UX hint, not trusted input

## Why this stack

If you search for "React address auto-fill" you mostly find `useState` + `useEffect` examples that fetch on every change. They work, but they fall short on validation, type inference, render scope, and testability compared to the stack below.

| Concern | useState + useEffect | React Hook Form + Zod + jpzip |
|---|---|---|
| Type inference | Hand-written interface | `z.infer` from the Zod schema |
| Validation | Hand-rolled at submit time | `zodResolver` unifies submit / blur / change validation |
| Render scope | Parent rerenders, every input rerenders | Field-level — only the postcode input rerenders on blur |
| Error display | Custom `errors.zipcode && <span>` | Read `formState.errors.zipcode` directly |
| Testability | Manual `act` wrapping | `<FormProvider>` is RTL-friendly |
| Async lookup deduplication | Custom AbortController | One `useRef` line inside onBlur |

It looks like a mismatch — forms are state machines, and "an address appears later" feels async-ugly. But `setValue`'s flags (`shouldValidate`, `shouldDirty`, `shouldTouch`) are designed exactly for this: external effects that should be reflected in validation state without going through user input.

## Integration steps

### 1. Install dependencies

```bash
npm install react-hook-form zod @hookform/resolvers @jpzip/jpzip
```

`@hookform/resolvers` is the bridge between RHF and Zod. `@jpzip/jpzip` has zero runtime dependencies, so the net install is effectively the three libraries you actually use.

### 2. Define the Zod schema

```ts
import { z } from 'zod';

export const addressSchema = z.object({
  zipcode: z
    .string()
    .regex(/^\d{7}$/, 'Postcode must be 7 digits'),
  prefecture: z.string().min(1, 'Prefecture is required'),
  city: z.string().min(1, 'City is required'),
  town: z.string().min(1, 'Town / street is required'),
});

export type AddressFormValues = z.infer<typeof addressSchema>;
```

Two non-obvious choices:

- **No `async refine` calling `lookup`.** Zod async refines only run at submit or blur, which is too late for an "auto-fill as soon as you finish typing" UX. Existence checking belongs on the server
- The regex is **syntax-only**: `231-0017` (with a hyphen) is stripped during `setValueAs` in the next step, so the schema-level value is always seven digits

### 3. Wire up useForm with zodResolver

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

  const onPostalBlur = async (_e: React.FocusEvent<HTMLInputElement>) => {
    /* filled in next step */
  };

  return (
    <form onSubmit={handleSubmit((v) => console.log(v))} className="h-adr">
      <label>
        Postcode
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
      {/* prefecture / city / town inputs next */}
    </form>
  );
};
```

`setValueAs` strips the hyphen from `231-0017`, so RHF state always holds seven digits. `maxLength={8}` leaves room for one separator while typing.

### 4. Call `jpzip.lookup` on blur and use `setValue` to fill

```tsx
import { lookup } from '@jpzip/jpzip';

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/[^\d]/g, '');
  if (raw.length !== 7) return;
  const entry = await lookup(raw);
  if (!entry) {
    setStatus('Postcode not found');
    return;
  }
  setValue('prefecture', entry.prefecture, { shouldValidate: true });
  setValue('city', entry.city, { shouldValidate: true });
  setValue('town', entry.towns[0]?.town ?? '', { shouldValidate: true });
  setStatus('Address filled');
};
```

`shouldValidate: true` re-runs the `min(1)` rule for `prefecture`, `city`, and `town`, which clears the "required field" error the moment the address arrives.

For postcodes that map to multiple towns (`towns.length > 1` — business postcodes and some rural splits), this implementation picks the first entry. If your domain requires disambiguation (e.g. tax filings), branch here into a `<select>` of all towns.

### 5. Suppress duplicate lookups with `useRef`

`onBlur` fires every time focus leaves the field, even when the value has not changed. Cache the last successful postcode and short-circuit.

```tsx
import { useRef } from 'react';

const lastLookedUp = useRef<string>('');

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/[^\d]/g, '');
  if (raw.length !== 7) return;
  if (raw === lastLookedUp.current) return;
  lastLookedUp.current = raw;
  // ... lookup + setValue
};
```

The L1 LRU makes repeat lookups about 0.3 ms. The reason to dedupe is `setValue`, not bandwidth: if the user manually edits the town field and then bounces focus off the postcode field again, you do not want the original town value to come back.

### 6. Add accessibility attributes

```tsx
const [isLooking, setIsLooking] = useState(false);
const [status, setStatus] = useState<string>('');

const onPostalBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
  // ...early returns
  setIsLooking(true);
  try {
    const entry = await lookup(raw);
    // ...setValue group
  } finally {
    setIsLooking(false);
  }
};

return (
  <form onSubmit={handleSubmit((v) => console.log(v))} className="h-adr">
    <label>
      Postcode
      <input
        {...register('zipcode', { setValueAs: (v: string) => v.replace(/[^\d]/g, '') })}
        onBlur={onPostalBlur}
        aria-busy={isLooking}
        inputMode="numeric"
        maxLength={8}
      />
    </label>
    <output role="status" aria-live="polite">{status}</output>
    {/* prefecture / city / town inputs */}
  </form>
);
```

- `aria-busy={isLooking}` — assistive tech announces the busy state and can render a spinner indication
- `<output role="status" aria-live="polite">` — non-intrusively announces "Address filled" or "Postcode not found" when it changes
- `inputMode="numeric"` — opens the numeric keyboard on mobile (a UX win that doubles as a hint for screen readers in some browsers)

### 7. Re-validate on the server

Client-side auto-fill is a UX convenience. Users can hand-edit the address before submitting, so the server has to re-verify.

```ts
// app/api/address/route.ts (Next.js Route Handler example)
import { lookup } from '@jpzip/jpzip';
import { addressSchema } from '@/lib/address-schema';

export const runtime = 'edge';

export async function POST(req: Request) {
  const body = addressSchema.parse(await req.json());
  const entry = await lookup(body.zipcode);
  if (!entry) {
    return Response.json({ error: 'invalid zipcode' }, { status: 422 });
  }
  if (entry.prefecture !== body.prefecture || entry.city !== body.city) {
    return Response.json({ error: 'address mismatch' }, { status: 422 });
  }
  // persist
  return Response.json({ ok: true });
}
```

`@jpzip/jpzip` is Edge-compatible, so `export const runtime = 'edge'` works without changes.

## Common pitfalls

- **Forgetting `shouldValidate: true`**: without it, the required-field errors on `prefecture` / `city` / `town` stay red even though the values are filled. Users see the values populated and the form complaining at the same time
- **Choosing `mode: 'onChange'`**: validating on every keystroke makes the postcode regex error flicker as the user types digits. `onBlur` is the right default here
- **Using `Controller` when `register` is enough**: native `<input>` works with `register`. Reach for `Controller` only when the wrapped component (Material UI, Mantine, Headless UI) has a non-standard onChange signature
- **Not deciding on multi-town behavior**: business postcodes and some rural splits return `towns.length > 1`. Defaulting to `towns[0]` is fine for e-commerce checkout but unsafe for forms where the exact town matters
- **Skipping server-side re-lookup**: if the server trusts the submitted prefecture/city, a user can submit a mismatched address by editing the auto-filled values. Always re-call `lookup` server-side and compare
- **Forgetting `'use client'` in Next.js App Router**: omitting it makes `useForm` execute during SSR and throw. The `AddressForm` component must start with `'use client';`

## Verifying with Vitest + React Testing Library

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

  it('fills address fields after onBlur with a valid postcode', async () => {
    const user = userEvent.setup();
    render(<AddressForm />);
    await user.type(screen.getByLabelText('Postcode'), '231-0017');
    await user.tab(); // blur the postcode field
    await waitFor(() => {
      expect((screen.getByLabelText('Prefecture') as HTMLInputElement).value).toBe('神奈川県');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Address filled');
  });

  it('reports not-found when the postcode does not exist', async () => {
    const user = userEvent.setup();
    render(<AddressForm />);
    await user.type(screen.getByLabelText('Postcode'), '0000000');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Postcode not found');
    });
  });
});
```

The test postcode is **Yokohama City Hall (231-0017)** — a public landmark with a stable postcode that makes the assertion self-documenting. The whole `@jpzip/jpzip` module is replaced with a `vi.mock`; if you prefer to exercise the real `fetch` path, swap that for an [MSW](https://mswjs.io/) handler against `https://jpzip.nadai.dev/p/231.json`.

## Summary

React Hook Form + Zod + jpzip splits cleanly across "synchronous validation," "asynchronous lookup," and "form state." The single design decision that matters is to keep `lookup` out of Zod's async refine and inside an onBlur handler. The rest — `setValue` with `shouldValidate`, a `useRef` dedupe, `aria-busy` plus a polite `aria-live` status, and server-side re-validation — falls out almost mechanically.

These four moves take a working demo to a production-grade form.

Related reading:

- [The jpzip project overview](/blog/0001-cloudflare-pages-micro-saas/) — why the dataset is a static Cloudflare Pages deploy
- [Serving 120,677 entries from static JSON](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — why the L1 LRU makes the `setValue` retry pattern cheap
- [Migrating from Yubinbango to jpzip-js](/blog/0005-migrate-from-yubinbango-js/) — when you want to keep the existing `class="h-adr"` markup instead of rebuilding with React Hook Form
