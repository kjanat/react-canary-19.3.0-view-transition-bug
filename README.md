# React Issue Draft

**Repo:** <https://github.com/facebook/react>\
**Title:** `<ViewTransition>`: name prop changes don't trigger transitions without child DOM mutations

---

## Summary

A `<ViewTransition>` whose `name` prop changes between renders does not trigger the view transition update pipeline unless a child DOM mutation also occurs. This makes hero morphs via name-prop toggling on mounted components silently fail.

**Core problem:** the commit phase requires the `Update` flag (`flags & Update`) on the VT fiber for `applyViewTransitionName` to fire. This flag is only set when DOM mutations occur within the VT's child subtree. A `name` prop change — semantically meaningful for view transitions — doesn't set it.

**Compounding factor:** when `default='none'` and no explicit `update` prop is set, `getViewTransitionClassName(props.default, props.update)` returns `'none'` in the update path, gating out all VT processing before the flag check is even reached. The `share` prop is not consulted in the update path (only in enter/exit pairs).

No existing issue or PR addresses this (searched `facebook/react` 2026-03-08).

Reproduction: <https://codesandbox.io/p/sandbox/yx5sdy>\
Preview: <https://yx5sdy.csb.app/>

## Versions

- `react`: `19.3.0-canary-46103596-20260305`
- `react-dom`: `19.3.0-canary-46103596-20260305`
- Browser: Chromium 145 (stable)

## Reproduction

Standalone repro files (no bundler/build tooling):

- `index.html` (launcher)
- `broken.html`
- `workaround.html`

Broken case core snippet:

```tsx
import { addTransitionType, startTransition, useLayoutEffect, useRef, useState, ViewTransition } from 'react';

function App() {
	const [heroOwner, setHeroOwner] = useState<'button' | 'dialog'>('button');
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useLayoutEffect(() => {
		const dialog = dialogRef.current;
		if (heroOwner === 'dialog' && dialog !== null && !dialog.open) {
			dialog.showModal();
		}
	}, [heroOwner]);

	return (
		<>
			<ViewTransition
				name={heroOwner === 'button' ? 'camera-hero' : undefined}
				share='camera-hero-morph'
				default='none'
			>
				<button
					type='button'
					onClick={() =>
						startTransition(() => {
							addTransitionType('camera-modal');
							setHeroOwner('dialog');
						})}
				>
					Gebruik live camera
				</button>
			</ViewTransition>

			<ViewTransition
				name={heroOwner === 'dialog' ? 'camera-hero' : undefined}
				share='camera-hero-morph'
				default='none'
			>
				<dialog ref={dialogRef}>...</dialog>
			</ViewTransition>
		</>
	);
}
```

**Expected:** opening modal morphs smoothly from trigger button to dialog (shared `camera-hero` element).

**Actual:** modal appears instantly (jump/no hero morph). In internals, old snapshot gets the name but new snapshot is cancelled via `opacity: [0, 0]` path.

### Proposed correct behavior

When a `<ViewTransition>` component's `name` prop changes between renders, React should treat this as a view transition update regardless of whether child DOM mutations occurred. The name change itself is the semantically meaningful change that should drive the transition.

## Workaround

Two changes required simultaneously:

```tsx
import { addTransitionType, startTransition, useLayoutEffect, useRef, useState, ViewTransition } from 'react';

function App() {
	const [heroOwner, setHeroOwner] = useState<'button' | 'dialog'>('button');
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useLayoutEffect(() => {
		const dialog = dialogRef.current;
		if (heroOwner === 'dialog' && dialog !== null && !dialog.open) {
			dialog.showModal();
		}
	}, [heroOwner]);

	const updateConfig = { default: 'none', 'camera-modal': 'camera-hero-morph' };

	return (
		<>
			<ViewTransition
				name={heroOwner === 'button' ? 'camera-hero' : undefined}
				share='camera-hero-morph'
				default='none'
				update={updateConfig} // 1. explicit update mapping
			>
				<button
					type='button'
					data-hero-owner={heroOwner} // 2. force DOM mutation
					onClick={() =>
						startTransition(() => {
							addTransitionType('camera-modal');
							setHeroOwner('dialog');
						})}
				>
					Gebruik live camera
				</button>
			</ViewTransition>

			<ViewTransition
				name={heroOwner === 'dialog' ? 'camera-hero' : undefined}
				share='camera-hero-morph'
				default='none'
				update={updateConfig}
			>
				<dialog ref={dialogRef} data-hero-owner={heroOwner}>...</dialog>
			</ViewTransition>
		</>
	);
}
```

Both are necessary:

- The `update` prop unblocks VT processing (otherwise `default='none'` gates it out).
- The `data-owner={owner}` attribute change triggers a DOM mutation that sets the internal `Update` flag on the VT fiber.

The `data-owner` attribute serves no purpose other than tickling the mutation phase into setting a flag that logically should depend only on the name change itself.

## Root cause (source references)

All references below are GitHub permalinks to React commit [`4610359651fa10247159e2050f8ec222cb7faa91`][react-commit], matching `react-dom@19.3.0-canary-46103596-20260305` (`npm view react-dom@19.3.0-canary-46103596-20260305 gitHead`).

[react-commit]: https://github.com/facebook/react/commit/4610359651fa10247159e2050f8ec222cb7faa91 "React commit matching the canary build"

### 1. `Update` flag requires child DOM mutations

In [`measureViewTransitionHostInstancesRecursive`][measure-recursive], the `Update` flag gates whether `applyViewTransitionName` fires for the new snapshot:

```js
(parentViewTransition.flags & Update) !== NoFlags
	&& applyViewTransitionName(instance, newName, className);
```

The `Update` flag is set in the mutation phase ([`ReactFiberCommitWork.js#L2634-L2643`][update-flag-set]) only when `viewTransitionMutationContext` is `true`:

```js
viewTransitionMutationContext && (finishedWork.flags |= Update);
```

`viewTransitionMutationContext` is only `true` when a DOM mutation (attribute change, text change, element insertion/removal) occurs within the VT's child subtree during React's mutation commit. The `Update` flag can also be set during measurement if `hasInstanceChanged()` detects a bounding-rect change ([L676-680][measure-recursive]), but with a name-only prop change and no layout shift, measurements are identical and this path returns false.

If only the VT's `name` prop changes — with no child mutations and no layout change — the flag stays `NoFlags`. Without `Update`, the instance is not passed to `applyViewTransitionName` but is instead pushed to `viewTransitionCancelableChildren`, which triggers the zero-opacity cancellation path in [`ReactFiberConfigDOM.js#L1616-L1637`][cancel-animation]:

```js
current.animate(
	{ opacity: [0, 0], pointerEvents: ['none', 'none'] },
	{
		duration: 0,
		fill: 'forwards',
		pseudoElement: '::view-transition-group(' + oldName + ')',
	},
);
```

React already detects the name change in `beginWork` at [`ReactFiberBeginWork.js#L3617-L3621`][name-change-detected]:

```js
if (current !== null && current.memoizedProps.name !== pendingProps.name) {
	workInProgress.flags |= Ref | RefStatic;
}
```

This sets `Ref` flags for ref lifecycle but does not propagate into the commit phase as a VT update signal.

### 2. `default='none'` gates out the update path (compounding)

The `share` prop name suggests it controls shared-element/hero morphs, but it's only consulted in the **enter/exit pair** path in [`commitEnterViewTransitions`][commit-enter] and [`commitExitViewTransitions`][commit-exit]. When both VTs stay mounted and only change their `name` prop, React routes through the **update** path, which calls `getViewTransitionClassName(props.default, props.update)` in three places:

| Phase           | Source permalink                                                       | Gate                                                        |
| --------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Mutation        | [`ReactFiberCommitWork.js#L2623-L2633`][update-mutation-gate]          | `inUpdateViewTransition` — controls child mutation tracking |
| Before-mutation | [`ReactFiberCommitViewTransitions.js#L489-L512`][before-mutation-gate] | Whether to apply OLD VT name for old snapshot               |
| After-mutation  | [`ReactFiberCommitViewTransitions.js#L768-L803`][after-mutation-gate]  | Whether to measure and apply NEW VT name                    |

With `default='none'` and no `update` prop, all three return `'none'` and skip processing — the `Update` flag check is never reached.

## Suggested fix

The name-change detection in [`beginWork`][name-change-detected] (`current.memoizedProps.name !== pendingProps.name`) could additionally set the `Update` flag or an equivalent signal, so the commit phase treats the VT as updated even without child DOM mutations.

Additionally, the `share` className may need to be consulted in the update path when a name change is detected, not only in the enter/exit pair path.

## Docs note

The `<ViewTransition>` documentation distinguishes `share` (enter/exit pairing) from `update` (DOM mutations / layout effects), but does not clarify what should happen when only the `name` prop changes across already-mounted `<ViewTransition>` boundaries. It's unclear whether mounted name toggling is expected to produce a transition or is intentionally unsupported.

[commit-enter]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L287-L326 "commitEnterViewTransitions"
[commit-exit]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L409-L450 "commitExitViewTransitions"
[measure-recursive]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L642-L704 "measureViewTransitionHostInstancesRecursive"
[cancel-animation]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L1616-L1637 "cancelViewTransitionName zero-opacity cancellation path"
[update-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitWork.js#L2623-L2633 "Mutation-phase inUpdateViewTransition gate"
[update-flag-set]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitWork.js#L2634-L2643 "Mutation-phase Update flag assignment"
[before-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L489-L512 "Before-mutation old-name application gate"
[after-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L768-L803 "After-mutation new-name measurement gate"
[name-change-detected]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberBeginWork.js#L3617-L3621 "ViewTransition name-change detection in beginWork"

<!--markdownlint-disable-file-->
