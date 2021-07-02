/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactEventResponder,
  ReactContext,
  ReactEventResponderListener,
} from 'shared/ReactTypes';
import type {SideEffectTag} from 'shared/ReactSideEffectTags';
import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {HookEffectTag} from './ReactHookEffectTags';
import type {SuspenseConfig} from './ReactFiberSuspenseConfig';
import type {ReactPriorityLevel} from './SchedulerWithReactIntegration';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {NoWork} from './ReactFiberExpirationTime';
import {readContext} from './ReactFiberNewContext';
import {createResponderListener} from './ReactFiberEvents';
import {
  Update as UpdateEffect,
  Passive as PassiveEffect,
} from 'shared/ReactSideEffectTags';
import {
  NoEffect as NoHookEffect,
  UnmountMutation,
  MountLayout,
  UnmountPassive,
  MountPassive,
} from './ReactHookEffectTags';
import {
  scheduleWork,
  computeExpirationForFiber,
  requestCurrentTime,
  warnIfNotCurrentlyActingEffectsInDEV,
  warnIfNotCurrentlyActingUpdatesInDev,
  warnIfNotScopedWithMatchingAct,
  markRenderEventTimeAndConfig,
  markUnprocessedUpdateTime,
} from './ReactFiberWorkLoop';

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import getComponentName from 'shared/getComponentName';
import is from 'shared/objectIs';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork';
import {requestCurrentSuspenseConfig} from './ReactFiberSuspenseConfig';
import {getCurrentPriorityLevel} from './SchedulerWithReactIntegration';

const {ReactCurrentDispatcher} = ReactSharedInternals;

export type Dispatcher = {
  readContext<T>(
    context: ReactContext<T>,
    observedBits: void | number | boolean,
  ): T,
  useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>],
  useReducer<S, I, A>(
    reducer: (S, A) => S,
    initialArg: I,
    init?: (I) => S,
  ): [S, Dispatch<A>],
  useContext<T>(
    context: ReactContext<T>,
    observedBits: void | number | boolean,
  ): T,
  useRef<T>(initialValue: T): {current: T},
  useEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useLayoutEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useCallback<T>(callback: T, deps: Array<mixed> | void | null): T,
  useMemo<T>(nextCreate: () => T, deps: Array<mixed> | void | null): T,
  useImperativeHandle<T>(
    ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
    create: () => T,
    deps: Array<mixed> | void | null,
  ): void,
  useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void,
  useResponder<E, C>(
    responder: ReactEventResponder<E, C>,
    props: Object,
  ): ReactEventResponderListener<E, C>,
};

type Update<S, A> = {
  expirationTime: ExpirationTime,
  suspenseConfig: null | SuspenseConfig,
  action: A,
  eagerReducer: ((S, A) => S) | null,
  eagerState: S | null,
  next: Update<S, A> | null,

  priority?: ReactPriorityLevel,
};

type UpdateQueue<S, A> = {
  last: Update<S, A> | null,
  dispatch: (A => mixed) | null,
  lastRenderedReducer: ((S, A) => S) | null,
  lastRenderedState: S | null,
};

export type HookType =
  | 'useState'
  | 'useReducer'
  | 'useContext'
  | 'useRef'
  | 'useEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'useImperativeHandle'
  | 'useDebugValue'
  | 'useResponder';

let didWarnAboutMismatchedHooksForComponent;
if (__DEV__) {
  didWarnAboutMismatchedHooksForComponent = new Set();
}

export type Hook = {
  memoizedState: any,

  baseState: any,
  baseUpdate: Update<any, any> | null,
  queue: UpdateQueue<any, any> | null,

  next: Hook | null,
};

type Effect = {
  tag: HookEffectTag,
  create: () => (() => void) | void,
  destroy: (() => void) | void,
  deps: Array<mixed> | null,
  next: Effect,
};

export type FunctionComponentUpdateQueue = {
  lastEffect: Effect | null,
};

type BasicStateAction<S> = (S => S) | S;

type Dispatch<A> = A => void;

// These are set right before calling the component.
let renderExpirationTime: ExpirationTime = NoWork;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber | null = null;

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let currentHook: Hook | null = null;
let nextCurrentHook: Hook | null = null;
let firstWorkInProgressHook: Hook | null = null;
let workInProgressHook: Hook | null = null;
let nextWorkInProgressHook: Hook | null = null;

let remainingExpirationTime: ExpirationTime = NoWork;
let componentUpdateQueue: FunctionComponentUpdateQueue | null = null;
let sideEffectTag: SideEffectTag = 0;

// Updates scheduled during render will trigger an immediate re-render at the
// end of the current pass. We can't store these updates on the normal queue,
// because if the work is aborted, they should be discarded. Because this is
// a relatively rare case, we also don't want to add an additional field to
// either the hook or queue object types. So we store them in a lazily create
// map of queue -> render-phase updates, which are discarded once the component
// completes without re-rendering.

// Whether an update was scheduled during the currently executing render pass.
let didScheduleRenderPhaseUpdate: boolean = false;
// Lazily created map of render-phase updates
let renderPhaseUpdates: Map<
  UpdateQueue<any, any>,
  Update<any, any>,
> | null = null;
// Counter to prevent infinite loops.
let numberOfReRenders: number = 0;
const RE_RENDER_LIMIT = 25;

// In DEV, this is the name of the currently executing primitive hook
let currentHookNameInDev: ?HookType = null;

// In DEV, this list ensures that hooks are called in the same order between renders.
// The list stores the order of hooks used during the initial render (mount).
// Subsequent renders (updates) reference this list.
let hookTypesDev: Array<HookType> | null = null;
let hookTypesUpdateIndexDev: number = -1;

// In DEV, this tracks whether currently rendering component needs to ignore
// the dependencies for Hooks that need them (e.g. useEffect or useMemo).
// When true, such Hooks will always be "remounted". Only used during hot reload.
let ignorePreviousDependencies: boolean = false;

function mountHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev === null) {
      hookTypesDev = [hookName];
    } else {
      hookTypesDev.push(hookName);
    }
  }
}

function updateHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev !== null) {
      hookTypesUpdateIndexDev++;
      if (hookTypesDev[hookTypesUpdateIndexDev] !== hookName) {
        warnOnHookMismatchInDev(hookName);
      }
    }
  }
}

function checkDepsAreArrayDev(deps: mixed) {
  if (__DEV__) {
    if (deps !== undefined && deps !== null && !Array.isArray(deps)) {
      // Verify deps, but only on mount to avoid extra checks.
      // It's unlikely their type would change as usually you define them inline.
      warning(
        false,
        '%s received a final argument that is not an array (instead, received `%s`). When ' +
          'specified, the final argument must be an array.',
        currentHookNameInDev,
        typeof deps,
      );
    }
  }
}

function warnOnHookMismatchInDev(currentHookName: HookType) {
  if (__DEV__) {
    const componentName = getComponentName(
      ((currentlyRenderingFiber: any): Fiber).type,
    );
    if (!didWarnAboutMismatchedHooksForComponent.has(componentName)) {
      didWarnAboutMismatchedHooksForComponent.add(componentName);

      if (hookTypesDev !== null) {
        let table = '';

        const secondColumnStart = 30;

        for (let i = 0; i <= ((hookTypesUpdateIndexDev: any): number); i++) {
          const oldHookName = hookTypesDev[i];
          const newHookName =
            i === ((hookTypesUpdateIndexDev: any): number)
              ? currentHookName
              : oldHookName;

          let row = `${i + 1}. ${oldHookName}`;

          // Extra space so second column lines up
          // lol @ IE not supporting String#repeat
          while (row.length < secondColumnStart) {
            row += ' ';
          }

          row += newHookName + '\n';

          table += row;
        }

        warning(
          false,
          'React has detected a change in the order of Hooks called by %s. ' +
            'This will lead to bugs and errors if not fixed. ' +
            'For more information, read the Rules of Hooks: https://fb.me/rules-of-hooks\n\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '%s' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n',
          componentName,
          table,
        );
      }
    }
  }
}

function throwInvalidHookError() {
  invariant(
    false,
    'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
      ' one of the following reasons:\n' +
      '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
      '2. You might be breaking the Rules of Hooks\n' +
      '3. You might have more than one copy of React in the same app\n' +
      'See https://fb.me/react-invalid-hook-call for tips about how to debug and fix this problem.',
  );
}

function areHookInputsEqual(
  nextDeps: Array<mixed>,
  prevDeps: Array<mixed> | null,
) {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // Only true when this component is being hot reloaded.
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      warning(
        false,
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // Don't bother comparing lengths in prod because these arrays should be
    // passed inline.
    if (nextDeps.length !== prevDeps.length) {
      warning(
        false,
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

export function renderWithHooks(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  props: any,
  refOrContext: any,
  nextRenderExpirationTime: ExpirationTime,
): any {
  renderExpirationTime = nextRenderExpirationTime;
  // 这是当前正在渲染的 Fiber 
  currentlyRenderingFiber = workInProgress;
  // 如果当前的 fiber 已经存在，说明是 update 阶段
  nextCurrentHook = current !== null ? current.memoizedState : null;

  if (__DEV__) {
    hookTypesDev =
      current !== null
        ? ((current._debugHookTypes: any): Array<HookType>)
        : null;
    hookTypesUpdateIndexDev = -1;
    // Used for hot reloading:
    ignorePreviousDependencies =
      current !== null && current.type !== workInProgress.type;
  }

  // The following should have already been reset
  // currentHook = null;
  // workInProgressHook = null;

  // remainingExpirationTime = NoWork;
  // componentUpdateQueue = null;

  // didScheduleRenderPhaseUpdate = false;
  // renderPhaseUpdates = null;
  // numberOfReRenders = 0;
  // sideEffectTag = 0;

  // TODO Warn if no hooks are used at all during mount, then some are used during update.
  // Currently we will identify the update render as a mount because nextCurrentHook === null.
  // This is tricky because it's valid for certain types of components (e.g. React.lazy)

  // Using nextCurrentHook to differentiate between mount/update only works if at least one stateful hook is used.
  // Non-stateful hooks (e.g. context) don't get added to memoizedState,
  // so nextCurrentHook would be null during updates and mounts.
  if (__DEV__) {
    if (nextCurrentHook !== null) {
      ReactCurrentDispatcher.current = HooksDispatcherOnUpdateInDEV;
    } else if (hookTypesDev !== null) {
      // This dispatcher handles an edge case where a component is updating,
      // but no stateful hooks have been used.
      // We want to match the production code behavior (which will use HooksDispatcherOnMount),
      // but with the extra DEV validation to ensure hooks ordering hasn't changed.
      // This dispatcher does that.
      ReactCurrentDispatcher.current = HooksDispatcherOnMountWithHookTypesInDEV;
    } else {
      ReactCurrentDispatcher.current = HooksDispatcherOnMountInDEV;
    }
  } else {
    // current?.memoizedState 为 true ,则 dispatcher 为 HooksDispatcherOnUpdate，否则为 HooksDispatcherOnMount
    ReactCurrentDispatcher.current =
      nextCurrentHook === null
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
  }

  // 执行 Component() 函数即执行 FC，返回需要渲染的 VDom, 可见 FC 的参数为：props 和 refOrContext
  let children = Component(props, refOrContext);

  // dispatchAction 调用时，进入循环，dispatchAction 即为需要更新状态重新渲染时
  if (didScheduleRenderPhaseUpdate) {
    do {
      // 标志位置为了 false，则只会执行一次
      didScheduleRenderPhaseUpdate = false;
      // 记录渲染的次数，如果numberOfReRenders > RE_RENDER_LIMIT,就会报 Too many re-renders 的错误。
      numberOfReRenders += 1;
      if (__DEV__) {
        // Even when hot reloading, allow dependencies to stabilize
        // after first render to prevent infinite render phase updates.
        ignorePreviousDependencies = false;
      }

      // Start over from the beginning of the list
      nextCurrentHook = current !== null ? current.memoizedState : null;
      nextWorkInProgressHook = firstWorkInProgressHook;

      currentHook = null;
      workInProgressHook = null;
      componentUpdateQueue = null;

      if (__DEV__) {
        // Also validate hook order for cascading updates.
        hookTypesUpdateIndexDev = -1;
      }

      ReactCurrentDispatcher.current = __DEV__
        ? HooksDispatcherOnUpdateInDEV
        : HooksDispatcherOnUpdate;

      children = Component(props, refOrContext);
    } while (didScheduleRenderPhaseUpdate);

    renderPhaseUpdates = null;
    numberOfReRenders = 0;
  }

  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  // 渲染完毕后的 dispatcher 为 ContextOnlyDispatcher
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  // 更新 renderedWork 
  const renderedWork: Fiber = (currentlyRenderingFiber: any);

  renderedWork.memoizedState = firstWorkInProgressHook;
  renderedWork.expirationTime = remainingExpirationTime;
  renderedWork.updateQueue = (componentUpdateQueue: any);
  renderedWork.effectTag |= sideEffectTag;

  if (__DEV__) {
    renderedWork._debugHookTypes = hookTypesDev;
  }

  // This check uses currentHook so that it works the same in DEV and prod bundles.
  // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  // 做清理工作，防止这些变量污染下次执行
  renderExpirationTime = NoWork;
  currentlyRenderingFiber = null;

  currentHook = null;
  nextCurrentHook = null;
  firstWorkInProgressHook = null;
  workInProgressHook = null;
  nextWorkInProgressHook = null;

  if (__DEV__) {
    currentHookNameInDev = null;
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;
  }

  remainingExpirationTime = NoWork;
  componentUpdateQueue = null;
  sideEffectTag = 0;

  // These were reset above
  // didScheduleRenderPhaseUpdate = false;
  // renderPhaseUpdates = null;
  // numberOfReRenders = 0;

  invariant(
    !didRenderTooFewHooks,
    'Rendered fewer hooks than expected. This may be caused by an accidental ' +
      'early return statement.',
  );

  // 返回更新后的组件
  return children;
}

export function bailoutHooks(
  current: Fiber,
  workInProgress: Fiber,
  expirationTime: ExpirationTime,
) {
  workInProgress.updateQueue = current.updateQueue;
  workInProgress.effectTag &= ~(PassiveEffect | UpdateEffect);
  if (current.expirationTime <= expirationTime) {
    current.expirationTime = NoWork;
  }
}

export function resetHooks(): void {
  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrancy.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  // This is used to reset the state of this module when a component throws.
  // It's also called inside mountIndeterminateComponent if we determine the
  // component is a module-style component.

  renderExpirationTime = NoWork;
  currentlyRenderingFiber = null;

  currentHook = null;
  nextCurrentHook = null;
  firstWorkInProgressHook = null;
  workInProgressHook = null;
  nextWorkInProgressHook = null;

  if (__DEV__) {
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    currentHookNameInDev = null;
  }

  remainingExpirationTime = NoWork;
  componentUpdateQueue = null;
  sideEffectTag = 0;

  didScheduleRenderPhaseUpdate = false;
  renderPhaseUpdates = null;
  numberOfReRenders = 0;
}

function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,

    baseState: null,
    queue: null,
    baseUpdate: null,

    next: null,
  };

  if (workInProgressHook === null) {
    // This is the first hook in the list
    firstWorkInProgressHook = workInProgressHook = hook;
  } else {
    // Append to the end of the list
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook(): Hook {
  // This function is used both for updates and for re-renders triggered by a
  // render phase update. It assumes there is either a current hook we can
  // clone, or a work-in-progress hook from a previous render pass that we can
  // use as a base. When we reach the end of the base list, we must switch to
  // the dispatcher used for mounts.
  if (nextWorkInProgressHook !== null) {
    // There's already a work-in-progress. Reuse it.
    workInProgressHook = nextWorkInProgressHook;
    nextWorkInProgressHook = workInProgressHook.next;

    currentHook = nextCurrentHook;
    nextCurrentHook = currentHook !== null ? currentHook.next : null;
  } else {
    // Clone from the current hook.
    invariant(
      nextCurrentHook !== null,
      'Rendered more hooks than during the previous render.',
    );
    currentHook = nextCurrentHook;

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,

      baseState: currentHook.baseState,
      queue: currentHook.queue,
      baseUpdate: currentHook.baseUpdate,

      next: null,
    };

    if (workInProgressHook === null) {
      // This is the first hook in the list.
      workInProgressHook = firstWorkInProgressHook = newHook;
    } else {
      // Append to the end of the list.
      workInProgressHook = workInProgressHook.next = newHook;
    }
    nextCurrentHook = currentHook.next;
  }
  return workInProgressHook;
}

function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
  return {
    lastEffect: null,
  };
}

function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  return typeof action === 'function' ? action(state) : action;
}

function mountReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = mountWorkInProgressHook();
  let initialState;
  if (init !== undefined) {
    initialState = init(initialArg);
  } else {
    initialState = ((initialArg: any): S);
  }
  hook.memoizedState = hook.baseState = initialState;
  const queue = (hook.queue = {
    last: null,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: (initialState: any),
  });
  const dispatch: Dispatch<A> = (queue.dispatch = (dispatchAction.bind(
    null,
    // Flow doesn't know this is non-null, but we do.
    ((currentlyRenderingFiber: any): Fiber),
    queue,
  ): any));
  return [hook.memoizedState, dispatch];
}

function updateReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  // 当前正在调度的 hook
  const hook = updateWorkInProgressHook();
  // queue 就是上文中分析的 hook 更新的数据结构，queue 非空，即 queue 中的 update 一定不会为空。
  // 因为在useState mount 阶段会初始化一个 Update，并且 last 指针指向他。
  const queue = hook.queue;
  invariant(
    queue !== null,
    'Should have a queue. This is likely a bug in React. Please file an issue.',
  );

  // 最近用于渲染的 reducer 记录在 queue 上
  queue.lastRenderedReducer = reducer;
  // 如果 hook 已经 render 过
  if (numberOfReRenders > 0) {
    // This is a re-render. Apply the new render phase updates to the previous
    // work-in-progress hook.
    // 这里的 dispatch 是在上一次 setState 是挂载到 queue 上的，如果是 mount 阶段，
    // 也会返回一个 dispatch，可参照 mount 阶段
    const dispatch: Dispatch<A> = (queue.dispatch: any);
    // renderPhaseUpdates 中记录了更新队列，结构是  Map<UpdateQueue,Update>
    // 更新队列非空
    if (renderPhaseUpdates !== null) {
      // Render phase updates are stored in a map of queue -> linked list
      // 获取当前 hook 的第一个更新
      const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);
      // 如果没有需要更新的，则不必走下面的 reduce 过程
      if (firstRenderPhaseUpdate !== undefined) {
        // 经过下面 reduce 的过程，当前 queue 下所有的更新应该都被处理，
        // 所以这里可以提前将 queue 删掉，因为 queue 下面的 update 链表已经保存在 firstRenderPhaseUpdate
        // firstRenderPhaseUpdate 正在更新链表的头指针
        // 这里实际上是断开了 queue 和 firstRenderPhaseUpdate 的指向关系
        renderPhaseUpdates.delete(queue);
        // state reduce 过程以 memoizedState 为初始状态
        let newState = hook.memoizedState;
        let update = firstRenderPhaseUpdate;
        // 这个循环说明在useState的状态更新过程中，会将 update 组成一个一个的 queue，每个 queue 中的
        // 所有的 update 都是一起更新的，也就是一个更新链。河阳可以避免产生过多的无意义的 re-render，
        // 提高更新的效率。
        // 这里建表的更新是从链首到链首依次更新的。
        do {
          // Process this render phase update. We don't have to check the
          // priority because it will always be the same as the current
          // render's.
          // 每个 update 上都有一个 action ,具体可见上文 update 的结构
          // setState 的 action 是一个 BasicStateAction
          const action = update.action;
          // reducer 将当前状态转换为新状态
          newState = reducer(newState, action);
          // 指针移到下一个 update
          update = update.next;
        } while (update !== null);

        // Mark that the fiber performed work, but only if the new state is
        // different from the current state.
        // 如果最新状态 newState 和原状态 memoizedState 不一致，则 didReceiveUpdate 为 true
        // 表示在 fiber 上执行了更新
        if (!is(newState, hook.memoizedState)) {
          markWorkInProgressReceivedUpdate();
        }
        // 更新 memoizedState，方便下次 render
        hook.memoizedState = newState;
        // Don't persist the state accumulated from the render phase updates to
        // the base state unless the queue is empty.
        // TODO: Not sure if this is the desired semantics, but it's what we
        // do for gDSFP. I can't remember why.
        // 除非队列为空，否则不要将渲染阶段更新累积的状态持久化到基本状态。
        if (hook.baseUpdate === queue.last) {
          hook.baseState = newState;
        }
        // lastRenderedState 记录上一次的 state，此次 render 后，updates 链表将被回收，但是 map 
        // 上的 queue 却没有丢，并且将上次渲染状态更新为 newState
        queue.lastRenderedState = newState;
        // 经过 render 之后返回新状态 newState 和 dispatch 函数。dispatch 实际上是从 queue 上取的。
        return [newState, dispatch];
      }
    }
    // 没有经过 render，只需返回原状态 memoizedState。
    return [hook.memoizedState, dispatch];
  }
  
  // hook 首次 render,之所以要区分开，是因为首次 render 需要做一些初始化工作
  // The last update in the entire queue
  const last = queue.last;
  // The last update that is part of the base state.
  const baseUpdate = hook.baseUpdate;
  const baseState = hook.baseState;

  // Find the first unprocessed update.找到第一个未处理的更新
  let first;
  // baseUpdate 为上次的更新
  if (baseUpdate !== null) {
    if (last !== null) {
      // For the first update, the queue is a circular linked list where
      // `queue.last.next = queue.first`. Once the first update commits, and
      // the `baseUpdate` is no longer empty, we can unravel the list.
      // 这是首次 update，update.next ==== update, 如果是首次渲染，baseUpdate 应该为空
      // 而此处 baseUpdate 不为空，说明经过了首次渲染，所以将链表解开
      last.next = null;
    }
    // 正常情况下直接取 baseUpdate.next
    first = baseUpdate.next;
  } else {
    // 没有上次更新，取 last.next
    first = last !== null ? last.next : null;
  }
  if (first !== null) {
    // reduce 的初始状态
    let newState = baseState;
    let newBaseState = null;
    let newBaseUpdate = null;
    let prevUpdate = baseUpdate;
    let update = first;
    let didSkip = false;
    // 循环 reduce 状态，获取最新状态
    do {
      const updateExpirationTime = update.expirationTime;
      // 该 update 太新，未超过 renderExpirationTime，优先级较低
      if (updateExpirationTime < renderExpirationTime) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        // 对于优先级较低的 update,会先跳过。如果首次跳过，就应该对 newBaseUpdate、 newBaseState
        // 赋原值，否则不改变值即可
        if (!didSkip) {
          didSkip = true;
          newBaseUpdate = prevUpdate;
          newBaseState = newState;
        }
        // remainingExpirationTime 表示当前队列中不用立即渲染的低优先级的 update 中距离 renderExpirationTime
        // 最近的超时时间，这个时间越大，在下次渲染中该队列的优先级越大
        // Update the remaining priority in the queue.
        if (updateExpirationTime > remainingExpirationTime) {
          remainingExpirationTime = updateExpirationTime;
          markUnprocessedUpdateTime(remainingExpirationTime);
        }
      // 优先级达到标准的 update 会进行渲染
      } else {
        // This update does have sufficient priority.

        // Mark the event time of this update as relevant to this render pass.
        // TODO: This should ideally use the true event time of this update rather than
        // its priority which is a derived and not reverseable value.
        // TODO: We should skip this update if it was already committed but currently
        // we have no way of detecting the difference between a committed and suspended
        // update here.
        markRenderEventTimeAndConfig(
          updateExpirationTime,
          update.suspenseConfig,
        );

        // Process this update.
        if (update.eagerReducer === reducer) {
          // If this update was processed eagerly, and its reducer matches the
          // current reducer, we can use the eagerly computed state.
          // 如果有提前计算的 reducer, 并且和当前的 reducer 一样，可以使用提前计算的结果
          newState = ((update.eagerState: any): S);
        } else {
          // reduce 新的状态
          const action = update.action;
          newState = reducer(newState, action);
        }
      }
      // 保存原来的状态
      prevUpdate = update;
      // 移向下一个 update
      update = update.next;
      // first 已经执行过，移动到链尾
    } while (update !== null && update !== first);

    // 如果有首次跳过中断的 update，newBaseUpdate 记录中断前的 update，否则记录最新的 update
    if (!didSkip) {
      newBaseUpdate = prevUpdate;
      newBaseState = newState;
    }

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    // 标记前后状态是否确实有更新，didReceiveUpdate 标记为 true 时，才会真正去更新 Fiber
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    hook.baseUpdate = newBaseUpdate;
    hook.baseState = newBaseState;

    queue.lastRenderedState = newState;
  }

  const dispatch: Dispatch<A> = (queue.dispatch: any);
  return [hook.memoizedState, dispatch];
}

function mountState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  // hook 上记载了当前的 hook 的信息
  const hook = mountWorkInProgressHook();
  if (typeof initialState === 'function') {
    initialState = initialState();
  }
  // 初始状态被记载到memoizedState和baseState，其中 memoizedState 是上一次状态，baseState 是最初状态
  hook.memoizedState = hook.baseState = initialState;
  // 生成更新对象，准备入队列
  const queue = (hook.queue = {
    last: null,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: (initialState: any),
  });
  // 生成 setState 的回调方法，每个 setState 实质上是一个 dispatchAction
  const dispatch: Dispatch<
    BasicStateAction<S>,
  > = (queue.dispatch = (dispatchAction.bind(
    null,
    // Flow doesn't know this is non-null, but we do.
    ((currentlyRenderingFiber: any): Fiber),
    queue,
  ): any));
  return [hook.memoizedState, dispatch];
}

function updateState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer, (initialState: any));
}

function pushEffect(tag, create, destroy, deps) {
  // 创建一个 effect 对象，由于是 mount 阶段 next为 null.
  const effect: Effect = {
    tag,
    create,
    destroy,
    deps,
    // Circular
    next: (null: any),
  };
  if (componentUpdateQueue === null) {
    // 如果更新队列为空，则创建更新队列，这个队列里只记载了 lastEffect。
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    // 记录当前的 effect
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      // 将 firstEffect 指向 effect，effect 指向 firstEffect。即时将 effect 放到更新队列的队首。
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

function mountRef<T>(initialValue: T): {current: T} {
  const hook = mountWorkInProgressHook();
  const ref = {current: initialValue};
  if (__DEV__) {
    Object.seal(ref);
  }
  hook.memoizedState = ref;
  return ref;
}

function updateRef<T>(initialValue: T): {current: T} {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

function mountEffectImpl(fiberEffectTag, hookEffectTag, create, deps): void {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  sideEffectTag |= fiberEffectTag;
  // pushEffect 返回当前生成的 effect，这个 effect 被挂载到 hook.memoizedState 上。
  hook.memoizedState = pushEffect(hookEffectTag, create, undefined, nextDeps);
}

function updateEffectImpl(fiberEffectTag, hookEffectTag, create, deps): void {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy = undefined;

  if (currentHook !== null) {
    // 取出上一次的 effect
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    // 这里如果 prevDeps 不为空，则 nextDeps 一定不为空，因此如果为空，就不用产生 Effect 了。
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      // 比较 effect 是否发生了变化，只有 effect 变化，才生成 Effect，否则 tag 为 NoHookEffect
      //  tag 标记为 NoHookEffect 的 effect 不会被执行
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        pushEffect(NoHookEffect, create, destroy, nextDeps);
        return;
      }
    }
  }
  // 依赖项发生了变化时，生成 effect
  sideEffectTag |= fiberEffectTag;
  hook.memoizedState = pushEffect(hookEffectTag, create, destroy, nextDeps);
}

function mountEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
    if ('undefined' !== typeof jest) {
      warnIfNotCurrentlyActingEffectsInDEV(
        ((currentlyRenderingFiber: any): Fiber),
      );
    }
  }
  return mountEffectImpl(
    UpdateEffect | PassiveEffect,
    UnmountPassive | MountPassive,
    create,
    deps,
  );
}

function updateEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
    if ('undefined' !== typeof jest) {
      warnIfNotCurrentlyActingEffectsInDEV(
        ((currentlyRenderingFiber: any): Fiber),
      );
    }
  }
  return updateEffectImpl(
    UpdateEffect | PassiveEffect,
    UnmountPassive | MountPassive,
    create,
    deps,
  );
}

function mountLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return mountEffectImpl(
    UpdateEffect,
    UnmountMutation | MountLayout,
    create,
    deps,
  );
}

function updateLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(
    UpdateEffect,
    UnmountMutation | MountLayout,
    create,
    deps,
  );
}

function imperativeHandleEffect<T>(
  create: () => T,
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
) {
  if (typeof ref === 'function') {
    const refCallback = ref;
    const inst = create();
    refCallback(inst);
    return () => {
      refCallback(null);
    };
  } else if (ref !== null && ref !== undefined) {
    const refObject = ref;
    if (__DEV__) {
      warning(
        refObject.hasOwnProperty('current'),
        'Expected useImperativeHandle() first argument to either be a ' +
          'ref callback or React.createRef() object. Instead received: %s.',
        'an object with keys {' + Object.keys(refObject).join(', ') + '}',
      );
    }
    const inst = create();
    refObject.current = inst;
    return () => {
      refObject.current = null;
    };
  }
}

function mountImperativeHandle<T>(
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    warning(
      typeof create === 'function',
      'Expected useImperativeHandle() second argument to be a function ' +
        'that creates a handle. Instead received: %s.',
      create !== null ? typeof create : 'null',
    );
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return mountEffectImpl(
    UpdateEffect,
    UnmountMutation | MountLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

function updateImperativeHandle<T>(
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    warning(
      typeof create === 'function',
      'Expected useImperativeHandle() second argument to be a function ' +
        'that creates a handle. Instead received: %s.',
      create !== null ? typeof create : 'null',
    );
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  return updateEffectImpl(
    UpdateEffect,
    UnmountMutation | MountLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

function mountDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
  // This hook is normally a no-op.
  // The react-debug-hooks package injects its own implementation
  // so that e.g. DevTools can display custom hook values.
}

const updateDebugValue = mountDebugValue;

function mountCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps: Array<mixed> | null = prevState[1];
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function mountMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (prevState !== null) {
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) {
      const prevDeps: Array<mixed> | null = prevState[1];
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0];
      }
    }
  }
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function dispatchAction<S, A>(
  fiber: Fiber, // 当前渲染的 Fiber
  queue: UpdateQueue<S, A>, // 状态更新对象
  action: A,
) {
  // 避免渲染死循环，最多可连续渲染 25 次
  invariant(
    numberOfReRenders < RE_RENDER_LIMIT,
    'Too many re-renders. React limits the number of renders to prevent ' +
      'an infinite loop.',
  );

  if (__DEV__) {
    warning(
      typeof arguments[3] !== 'function',
      "State updates from the useState() and useReducer() Hooks don't support the " +
        'second callback argument. To execute a side effect after ' +
        'rendering, declare it in the component body with useEffect().',
    );
  }

  const alternate = fiber.alternate;
  if (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  ) { // 是否是当前需要渲染的 Fiber，进入渲染阶段
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    // 所有的 updates 会保存在一个 map 中，结构是： queue -> linked list
    // 进入渲染状态的标志
    didScheduleRenderPhaseUpdate = true;
    // 创建一个更新句柄
    const update: Update<S, A> = {
      expirationTime: renderExpirationTime,
      suspenseConfig: null,
      action,
      eagerReducer: null,
      eagerState: null,
      next: null,
    };
    if (__DEV__) {
      update.priority = getCurrentPriorityLevel();
    // renderPhaseUpdates 是存放 update queue 的一个队列，如果队列为空，则初始化队列
    if (renderPhaseUpdates === null) {
      renderPhaseUpdates = new Map();
    }
    // 取出当前 queue 中的 update 队列的首项
      const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);
    // 如果当前 queue 为空，则将创建的 update 放入队列
    if (firstRenderPhaseUpdate === undefined) {
      renderPhaseUpdates.set(queue, update);
    } else {
      // 将 queue 队列中首项追加到队尾
      // Append the update to the end of the list.
      let lastRenderPhaseUpdate = firstRenderPhaseUpdate;
      while (lastRenderPhaseUpdate.next !== null) {
        lastRenderPhaseUpdate = lastRenderPhaseUpdate.next;
      }
      lastRenderPhaseUpdate.next = update;
    }
  } else {
    const currentTime = requestCurrentTime();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    const update: Update<S, A> = {
      expirationTime,
      suspenseConfig,
      action,
      eagerReducer: null,
      eagerState: null,
      next: null,
    };

    if (__DEV__) {
      update.priority = getCurrentPriorityLevel();
    }
    // update 的数据结构，环状单向链表
    // Append the update to the end of the list.
    const last = queue.last;
      if (last === null) {
      // 如果这是一个空队列，即 update 就是首次更新，那就将 update 构成环形单向链表。
      // This is the first update. Create a circular list.
      update.next = update;
      } else {
      // 如果队列非空，队尾的 next 即为 first
      const first = last.next;
        if (first !== null) {
        // 如果队尾是有指向的，也就是已经形成了环形单向链表，那就直接把 update 放到队尾。
        // 即 update 的 next 指向 first。
        // Still circular.
        update.next = first;
        }
      // 如果没有成环，把 update 置于队尾
      last.next = update;
    }
    // 更新队尾指针
    queue.last = update;

    if ( // mount 阶段
      fiber.expirationTime === NoWork &&
      (alternate === null || alternate.expirationTime === NoWork)
    ) {
      // The queue is currently empty, which means we can eagerly compute the
      // next state before entering the render phase. If the new state is the
      // same as the current state, we may be able to bail out entirely.
      const lastRenderedReducer = queue.lastRenderedReducer;
      if (lastRenderedReducer !== null) {
        let prevDispatcher;
        if (__DEV__) {
          prevDispatcher = ReactCurrentDispatcher.current;
          ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
        }
        try {
          const currentState: S = (queue.lastRenderedState: any);
          const eagerState = lastRenderedReducer(currentState, action);
          // Stash the eagerly computed state, and the reducer used to compute
          // it, on the update object. If the reducer hasn't changed by the
          // time we enter the render phase, then the eager state can be used
          // without calling the reducer again.
          update.eagerReducer = lastRenderedReducer;
          update.eagerState = eagerState;
          if (is(eagerState, currentState)) {
            // Fast path. We can bail out without scheduling React to re-render.
            // It's still possible that we'll need to rebase this update later,
            // if the component re-renders for a different reason and by that
            // time the reducer has changed.
            return;
          }
        } catch (error) {
          // Suppress the error. It will throw again in the render phase.
        } finally {
          if (__DEV__) {
            ReactCurrentDispatcher.current = prevDispatcher;
          }
        }
      }
    }
    if (__DEV__) {
      // $FlowExpectedError - jest isn't a global, and isn't recognized outside of tests
      if ('undefined' !== typeof jest) {
        warnIfNotScopedWithMatchingAct(fiber);
        warnIfNotCurrentlyActingUpdatesInDev(fiber);
      }
    }
    // 调度 fiber 上的更新
    scheduleWork(fiber, expirationTime);
  }
}
}
export const ContextOnlyDispatcher: Dispatcher = {
  readContext,

  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useResponder: throwInvalidHookError,
};

const HooksDispatcherOnMount: Dispatcher = {
  readContext,

  useCallback: mountCallback,
  useContext: readContext,
  useEffect: mountEffect,
  useImperativeHandle: mountImperativeHandle,
  useLayoutEffect: mountLayoutEffect,
  useMemo: mountMemo,
  useReducer: mountReducer,
  useRef: mountRef,
  useState: mountState,
  useDebugValue: mountDebugValue,
  useResponder: createResponderListener,
};

const HooksDispatcherOnUpdate: Dispatcher = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: updateReducer,
  useRef: updateRef,
  useState: updateState,
  useDebugValue: updateDebugValue,
  useResponder: createResponderListener,
};

let HooksDispatcherOnMountInDEV: Dispatcher | null = null;
let HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher | null = null;
let HooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher | null = null;

if (__DEV__) {
  const warnInvalidContextAccess = () => {
    warning(
      false,
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  };

  const warnInvalidHookAccess = () => {
    warning(
      false,
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see ' +
        'https://fb.me/rules-of-hooks',
    );
  };

  HooksDispatcherOnMountInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useResponder<E, C>(
      responder: ReactEventResponder<E, C>,
      props,
    ): ReactEventResponderListener<E, C> {
      currentHookNameInDev = 'useResponder';
      mountHookTypesDev();
      return createResponderListener(responder, props);
    },
  };

  HooksDispatcherOnMountWithHookTypesInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useResponder<E, C>(
      responder: ReactEventResponder<E, C>,
      props,
    ): ReactEventResponderListener<E, C> {
      currentHookNameInDev = 'useResponder';
      updateHookTypesDev();
      return createResponderListener(responder, props);
    },
  };

  HooksDispatcherOnUpdateInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useResponder<E, C>(
      responder: ReactEventResponder<E, C>,
      props,
    ): ReactEventResponderListener<E, C> {
      currentHookNameInDev = 'useResponder';
      updateHookTypesDev();
      return createResponderListener(responder, props);
    },
  };

  InvalidNestedHooksDispatcherOnMountInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useResponder<E, C>(
      responder: ReactEventResponder<E, C>,
      props,
    ): ReactEventResponderListener<E, C> {
      currentHookNameInDev = 'useResponder';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return createResponderListener(responder, props);
    },
  };

  InvalidNestedHooksDispatcherOnUpdateInDEV = {
    readContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      warnInvalidContextAccess();
      return readContext(context, observedBits);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(
      context: ReactContext<T>,
      observedBits: void | number | boolean,
    ): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context, observedBits);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useResponder<E, C>(
      responder: ReactEventResponder<E, C>,
      props,
    ): ReactEventResponderListener<E, C> {
      currentHookNameInDev = 'useResponder';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return createResponderListener(responder, props);
    },
  };
}
