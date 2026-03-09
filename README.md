# React `<ViewTransition>` name-prop bug reproduction

Minimal reproduction for a React canary bug where changing a `<ViewTransition>` component's `name` prop between renders does **not** trigger a view transition unless a child DOM mutation also occurs.

**GitHub Pages preview:** <https://kjanat.github.io/react-canary-19.3.0-view-transition-bug/>\
**Live sandbox:** <https://codesandbox.io/p/sandbox/yx5sdy> ([preview](https://yx5sdy.csb.app/))

Open the app and toggle between **Broken** and **Workaround** modes to see the difference.

## Versions

- `react`: `19.3.0-canary-46103596-20260305`
- `react-dom`: `19.3.0-canary-46103596-20260305`

Repro component in [`src/Repro.tsx`][repro], view-transition CSS in [`src/styles.css`][styles], debug instrumentation in [`src/debug.ts`][debug].

---

## Bug summary

In this repro, a `<ViewTransition>` whose [`name` prop changes between renders][repro-vt-blocks] does not trigger the view transition update pipeline unless a child DOM mutation also occurs. The result is that hero morphs via name-prop toggling on mounted components silently produce no animation.

**Core problem:** in the update path, React requires the `Update` flag (`flags & Update`) on the `<ViewTransition>` fiber before applying the new view-transition name to host instances. In this repro, that flag is set when a child DOM mutation occurs, but not when only the `name` prop changes. As a result, a semantically meaningful VT change (`name`) is not treated as an update by itself.

**Compounding factor:** when [`default='none'`][repro-default-none] and no explicit `update` prop is set, `getViewTransitionClassName(props.default, props.update)` returns `'none'` in the before-mutation and after-mutation phases, gating out snapshot capture and measurement/animation respectively. The mutation-phase `Update` flag assignment is independent of the class name — it is gated by `viewTransitionMutationContext`. So `default='none'` doesn't prevent the `Update` flag from being set; it prevents the flag from having any effect.

**Separate observation:** the `share` prop is not consulted in the update path (only in enter/exit pairs). This may be by-design (the update path handles DOM mutations, not shared-element pairing), but the documentation is silent on the expected behavior when only `name` changes on a mounted `<ViewTransition>`.

No existing issue or PR covers this in `facebook/react` as of 2026-03-08.

### Expected

Opening the modal morphs smoothly from trigger button to dialog (shared [`camera-hero`][repro-vt-blocks] element, [CSS animation][repro-hero-css]).

### Actual

Modal appears instantly — no hero morph animation. See [root cause §1](#1-name-only-changes-do-not-produce-update) for the code path that leads to a zero-opacity cancellation.

### Proposed correct behavior

When a `<ViewTransition>` component's `name` prop changes between renders, React should treat this as a view transition update regardless of whether child DOM mutations occurred. The name change itself is the semantically meaningful change that should drive the transition.

## Workaround

Two changes required simultaneously (visible in workaround mode):

1. [**`update` prop**][repro-update-prop] — unblocks VT processing (otherwise `default='none'` gates it out)
2. [**`data-hero-owner={heroOwner}`**][repro-mutation-hack] attribute — forces a DOM mutation that sets the internal `Update` flag on the VT fiber

In this repro, the `data-hero-owner` attribute serves no purpose other than forcing a child DOM mutation that sets a flag which logically should depend on the name change itself.

## Root cause (source references)

All references below are GitHub permalinks to React commit [`4610359651fa10247159e2050f8ec222cb7faa91`][react-commit], matching `react-dom@19.3.0-canary-46103596-20260305`.

[react-commit]: https://github.com/facebook/react/commit/4610359651fa10247159e2050f8ec222cb7faa91 "React commit matching the canary build"

### 1. Name-only changes do not produce `Update`

In [`measureViewTransitionHostInstancesRecursive`][measure-recursive], the `Update` flag gates whether `applyViewTransitionName` fires for the new snapshot:

```js
(parentViewTransition.flags & Update) !== NoFlags
  && applyViewTransitionName(instance, newName, className);
```

In this code path, the `Update` flag is set in the mutation phase ([`ReactFiberCommitWork.js#L2634-L2645`][update-flag-set]) when `viewTransitionMutationContext` is `true`:

```js
viewTransitionMutationContext && (finishedWork.flags |= Update);
```

In this repro, `viewTransitionMutationContext` becomes `true` when a DOM mutation (attribute change, text change, element insertion/removal) occurs within the VT's child subtree during the mutation commit. The `Update` flag can also be set during measurement if `hasInstanceChanged()` detects a bounding-rect change ([L676-681][has-instance-changed]), but in this scenario (name-only prop change, no layout shift), measurements are identical and this path returns false.

When only the VT's `name` prop changes, with no child mutations and no layout change, the flag stays `NoFlags`. Without `Update`, the instance is not passed to `applyViewTransitionName` but is instead pushed to `viewTransitionCancelableChildren`, which leads to a zero-opacity cancellation path in [`ReactFiberConfigDOM.js#L1616-L1640`][cancel-animation]:

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

> **Note:** this cancellation path is only reachable when the `update` prop unblocks before-mutation snapshot capture and after-mutation measurement. With `default='none'` and no `update` prop, host instances never receive VT names in the first place, so they never reach `viewTransitionCancelableChildren`. The zero-opacity cancellation manifests specifically in the partial-workaround state (setting `update` without also forcing a DOM mutation).

React already detects the name change in `beginWork` at [`ReactFiberBeginWork.js#L3617-L3622`][name-change-detected]:

```js
if (current !== null && current.memoizedProps.name !== pendingProps.name) {
  workInProgress.flags |= Ref | RefStatic;
}
```

This sets `Ref | RefStatic` for ref lifecycle, but it does not propagate into the commit phase as a VT update signal.

### 2. `default='none'` gates out the update path (compounding)

The `share` prop name suggests it controls shared-element/hero morphs, but in the source it is consulted in the **enter/exit pair** path ([`commitEnterViewTransitions`][commit-enter] and [`commitExitViewTransitions`][commit-exit]) and not in the update path. When both VTs stay mounted and only change their `name` prop, React routes through the **update** path, which calls `getViewTransitionClassName(props.default, props.update)` in two phases:

| Phase           | Source permalink                                                       | Gate                                                                |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Before-mutation | [`ReactFiberCommitViewTransitions.js#L489-L513`][before-mutation-gate] | Class name `=== 'none'` → skip old-snapshot VT name application     |
| After-mutation  | [`ReactFiberCommitViewTransitions.js#L768-L803`][after-mutation-gate]  | Class name `=== 'none'` → skip measurement and new-snapshot VT name |

The mutation phase ([`ReactFiberCommitWork.js#L2623-L2633`][update-mutation-gate]) also checks the class name to set `inUpdateViewTransition`, but this variable controls Portal context propagation in the traced code path — the `Update` flag assignment at [L2634-L2645][update-flag-set] is gated by `viewTransitionMutationContext`, not by the class name.\
So `default='none'` blocks the before/after-mutation phases, while the missing DOM mutation independently blocks the `Update` flag.

## Suggested fix

The name-change detection in [`beginWork`][name-change-detected] (`current.memoizedProps.name !== pendingProps.name`) could additionally set the `Update` flag or an equivalent signal, so the commit phase treats the VT as updated even without child DOM mutations.

A cleaner alternative is to keep the fix local to the mutation-phase commit handler for `ViewTransitionComponent`, adding a name-change check alongside `viewTransitionMutationContext`:

```js
} else if (
  viewTransitionMutationContext
  || current.memoizedProps.name !== finishedWork.memoizedProps.name
) {
  finishedWork.flags |= Update;
}
```

This would keep the `Update` flag closer to its apparent current usage (set during mutation phase, consumed in measurement) without changing `beginWork` flag behavior.

Additionally, the `share` className may need to be consulted in the update path when a name change is detected, not only in the enter/exit pair path.

## Docs note

The `<ViewTransition>` documentation distinguishes `share` (enter/exit pairing) from `update` (DOM mutations / layout effects), but does not clarify what should happen when only the `name` prop changes across already-mounted `<ViewTransition>` boundaries. It's unclear whether mounted name toggling is expected to produce a transition or is intentionally unsupported.

## License

[MIT](LICENSE)

<!--link-definitions: repo source-->

[index]: src/index.tsx "React root mount"
[repro]: src/Repro.tsx "Repro component"
[debug]: src/debug.ts "VT warning suppression + animation debug counters"
[styles]: src/styles.css "Styling + view-transition CSS"
[repro-vt-blocks]: src/Repro.tsx#L106-L135 "Both <ViewTransition> boundaries with name-prop toggling"
[repro-default-none]: src/Repro.tsx#L109 "default='none' on first VT boundary"
[repro-update-prop]: src/Repro.tsx#L110 "Workaround: conditional update prop spread"
[repro-mutation-hack]: src/Repro.tsx#L117 "Workaround: data-hero-owner DOM mutation hack"
[repro-hero-css]: src/styles.css#L440-L478 "Hero morph view-transition CSS animations"

<!--link-definitions: React source-->

[commit-enter]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L287-L326 "commitEnterViewTransitions"
[commit-exit]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L409-L451 "commitExitViewTransitions"
[measure-recursive]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L642-L705 "measureViewTransitionHostInstancesRecursive"
[has-instance-changed]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L676-L681 "hasInstanceChanged bounding-rect check"
[cancel-animation]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L1616-L1640 "cancelViewTransitionName zero-opacity cancellation path"
[update-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitWork.js#L2623-L2633 "Mutation-phase inUpdateViewTransition gate"
[update-flag-set]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitWork.js#L2634-L2645 "Mutation-phase Update flag assignment"
[before-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L489-L513 "Before-mutation old-name application gate"
[after-mutation-gate]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberCommitViewTransitions.js#L768-L803 "After-mutation new-name measurement gate"
[name-change-detected]: https://github.com/facebook/react/blob/4610359651fa10247159e2050f8ec222cb7faa91/packages/react-reconciler/src/ReactFiberBeginWork.js#L3617-L3622 "ViewTransition name-change detection in beginWork"

<!--markdownlint-disable-file-->
