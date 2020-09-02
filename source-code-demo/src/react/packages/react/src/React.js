/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// -------------------------------------------------- //
// -------------------------------------------------- //
// ------------- React API 总和  --------------------- //
// -------------------------------------------------- //
// -------------------------------------------------- //

import ReactVersion from 'shared/ReactVersion';
import {
  REACT_FRAGMENT_TYPE,
  REACT_PROFILER_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
} from 'shared/ReactSymbols';

import {Component, PureComponent} from './ReactBaseClasses';
import {createRef} from './ReactCreateRef';
import {forEach, map, count, toArray, only} from './ReactChildren';
import {
  createElement,
  createFactory,
  cloneElement,
  isValidElement,
  jsx,
} from './ReactElement';
import {createContext} from './ReactContext';
import {lazy} from './ReactLazy';
import forwardRef from './forwardRef';
import memo from './memo';
import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useDebugValue,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useResponder,
} from './ReactHooks';
import {withSuspenseConfig} from './ReactBatchConfig';
import {
  createElementWithValidation,
  createFactoryWithValidation,
  cloneElementWithValidation,
  jsxWithValidation,
  jsxWithValidationStatic,
  jsxWithValidationDynamic,
} from './ReactElementValidator';
import ReactSharedInternals from './ReactSharedInternals';
import createFundamental from 'shared/createFundamentalComponent';
import createResponder from 'shared/createEventResponder';
import createScope from 'shared/createScope';
import {
  enableJSXTransformAPI,
  enableFlareAPI,
  enableFundamentalAPI,
  enableScopeAPI,
} from 'shared/ReactFeatureFlags';
// ---------- 什么是React ---------- //
const React = {
  // ReactChildren提供了处理 this.props.children 的工具集，跟旧版本的一样
  Children: { // 操作ReactChildren的方法。ReactChildren不是数组。模拟数组的一些方法。
    map,
    forEach,
    count,
    toArray,
    only,
  },
  // 旧版本只有ReactComponent一种
  // 新版本定义了三种不同类型的组件基类Component，PureComponent ，unstable_AsyncComponent （16.2.0）
  createRef, // 创建ref用于类组件。
  Component, // 组件
  PureComponent,

  createContext,
  forwardRef, // ref转发
  lazy, // 懒导入
  memo, // 缓存优化

  // -------------------------------------------------- //
  // -------------------------------------------------- //
  // ------------- Hook API       --------------------- //
  // -------------------------------------------------- //
  // -------------------------------------------------- //
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useDebugValue,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,

  Fragment: REACT_FRAGMENT_TYPE,
  Profiler: REACT_PROFILER_TYPE,
  StrictMode: REACT_STRICT_MODE_TYPE, // 严格模式
  Suspense: REACT_SUSPENSE_TYPE, // 与lazy结合使用，指定一个feedback。
  unstable_SuspenseList: REACT_SUSPENSE_LIST_TYPE,
  // 生成组件
  // ! createElement/cloneElement开发环境与产品环境不一样。
  createElement: __DEV__ ? createElementWithValidation : createElement,
  cloneElement: __DEV__ ? cloneElementWithValidation : cloneElement,
  createFactory: __DEV__ ? createFactoryWithValidation : createFactory,
  isValidElement: isValidElement,

  version: ReactVersion,

  unstable_withSuspenseConfig: withSuspenseConfig,

  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ReactSharedInternals,
};

if (enableFlareAPI) {
  React.unstable_useResponder = useResponder;
  React.unstable_createResponder = createResponder;
}

if (enableFundamentalAPI) {
  React.unstable_createFundamental = createFundamental;
}

if (enableScopeAPI) {
  React.unstable_createScope = createScope;
}

// Note: some APIs are added with feature flags.
// Make sure that stable builds for open source
// don't modify the React object to avoid deopts.
// Also let's not expose their names in stable builds.

if (enableJSXTransformAPI) {
  if (__DEV__) {
    React.jsxDEV = jsxWithValidation;
    React.jsx = jsxWithValidationDynamic;
    React.jsxs = jsxWithValidationStatic;
  } else {
    React.jsx = jsx;
    // we may want to special case jsxs internally to take advantage of static children.
    // for now we can ship identical prod functions
    React.jsxs = jsx;
  }
}

export default React;
