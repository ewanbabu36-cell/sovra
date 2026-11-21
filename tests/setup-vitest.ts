import path from 'node:path';

function patchReactInstance(r: any) {
  if (!r) return;
  const dispatcher = {
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => typeof fn === 'function' ? fn() : fn,
    useRef: (initial: any) => ({ current: initial }),
    useContext: (ctx: any) => ctx?._currentValue,
    useReducer: (reducer: any, initial: any, init: any) => [init ? init(initial) : initial, () => {}],
    useId: () => 'id_mock',
    useTransition: () => [false, (fn: any) => typeof fn === 'function' ? fn() : undefined],
    useDeferredValue: (val: any) => val,
    useImperativeHandle: () => {},
    useLayoutEffect: () => {},
    useInsertionEffect: () => {},
    useDebugValue: () => {},
    useSyncExternalStore: (subscribe: any, getSnapshot: any) => getSnapshot(),
  };

  // React 19 / Modern
  try {
    const internals19 = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (internals19) {
      internals19.H = dispatcher;
    }
  } catch (_) {}

  // React 18 / Legacy
  try {
    const internals18 = r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    if (internals18 && internals18.ReactCurrentDispatcher) {
      internals18.ReactCurrentDispatcher.current = dispatcher;
    }
  } catch (_) {}
}

// 1. Patch default root react
try {
  const rootReact = await import('react');
  patchReactInstance(rootReact.default || rootReact);
} catch (_) {}

// 2. Patch react@18.3.1 specifically
try {
  const r18Path = path.resolve('node_modules/.pnpm/react@18.3.1/node_modules/react/index.js');
  const r18 = await import(r18Path);
  patchReactInstance(r18.default || r18);
} catch (_) {}
